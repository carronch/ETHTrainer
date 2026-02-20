// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAavePool, IFlashLoanSimpleReceiver} from "./interfaces/IAavePool.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @title LiquidationBot
/// @notice Executes Aave v3 liquidations using flash loans.
///         Flow: flash loan debt → liquidationCall → swap collateral → repay → profit stays.
///         Owner calls withdraw() to collect profits.
/// @dev Only owner can initiate. Uses Uniswap v3 SwapRouter02 (no deadline).
contract LiquidationBot is IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public immutable pool;      // Aave v3 Pool
    address public immutable router;    // Uniswap v3 SwapRouter02

    struct LiquidationParams {
        address collateralAsset;
        address debtAsset;
        address userToLiquidate;
        uint24  uniswapPoolFee;
        uint256 minProfitWei;   // minimum profit in debtAsset units; reverts if not met
    }

    event LiquidationExecuted(
        address indexed borrower,
        address collateralAsset,
        address debtAsset,
        uint256 debtCovered,
        uint256 collateralReceived,
        uint256 profit
    );

    error NotOwner();
    error NotPool();
    error NotSelf();
    error InsufficientProfit(uint256 got, uint256 required);

    constructor(address _pool, address _router) {
        owner  = msg.sender;
        pool   = _pool;
        router = _router;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Initiate a flash-loan-backed liquidation.
    /// @param collateralAsset  The asset to seize from the borrower.
    /// @param debtAsset        The asset to repay on behalf of the borrower.
    /// @param userToLiquidate  The underwater borrower address.
    /// @param debtToCover      Amount of debt to repay. Pass type(uint256).max to let Aave choose max.
    /// @param uniswapPoolFee   Uniswap v3 fee tier for collateral→debt swap (100/500/3000/10000).
    /// @param minProfitWei     Minimum acceptable profit in debtAsset units. Reverts if not met.
    function liquidate(
        address collateralAsset,
        address debtAsset,
        address userToLiquidate,
        uint256 debtToCover,
        uint24  uniswapPoolFee,
        uint256 minProfitWei
    ) external onlyOwner {
        bytes memory params = abi.encode(LiquidationParams({
            collateralAsset:   collateralAsset,
            debtAsset:         debtAsset,
            userToLiquidate:   userToLiquidate,
            uniswapPoolFee:    uniswapPoolFee,
            minProfitWei:      minProfitWei
        }));

        IAavePool(pool).flashLoanSimple(
            address(this),  // receiver
            debtAsset,      // asset to borrow
            debtToCover,    // amount to borrow
            params,
            0               // referralCode
        );
    }

    /// @notice Aave callback — called after flash loan is disbursed.
    ///         Must approve repayment before returning true.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Security: only Aave Pool can call; only this contract can initiate
        if (msg.sender != pool)          revert NotPool();
        if (initiator != address(this))  revert NotSelf();

        LiquidationParams memory p = abi.decode(params, (LiquidationParams));

        // 1. Approve Pool to pull the debt asset for liquidation
        IERC20(asset).forceApprove(pool, amount);

        // 2. Execute liquidation — seize collateral, repay debt
        uint256 collateralBefore = IERC20(p.collateralAsset).balanceOf(address(this));
        IAavePool(pool).liquidationCall(
            p.collateralAsset,
            p.debtAsset,
            p.userToLiquidate,
            type(uint256).max,  // let Aave determine max liquidatable amount
            false               // receive underlying token, not aToken
        );
        uint256 collateralReceived = IERC20(p.collateralAsset).balanceOf(address(this)) - collateralBefore;

        // 3. Swap collateral → debt asset (if they differ)
        uint256 debtAssetReceived = amount; // will be updated if we swap
        if (p.collateralAsset != p.debtAsset && collateralReceived > 0) {
            uint256 repaymentDue = amount + premium;
            IERC20(p.collateralAsset).forceApprove(router, collateralReceived);
            debtAssetReceived = ISwapRouter(router).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           p.collateralAsset,
                    tokenOut:          p.debtAsset,
                    fee:               p.uniswapPoolFee,
                    recipient:         address(this),
                    amountIn:          collateralReceived,
                    amountOutMinimum:  repaymentDue + p.minProfitWei,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // 4. Repay flash loan (amount + premium)
        uint256 repayment = amount + premium;
        uint256 debtBalance = IERC20(asset).balanceOf(address(this));
        if (debtBalance < repayment + p.minProfitWei) {
            revert InsufficientProfit(debtBalance - repayment, p.minProfitWei);
        }
        IERC20(asset).forceApprove(pool, repayment);

        uint256 profit = debtBalance - repayment;
        emit LiquidationExecuted(
            p.userToLiquidate,
            p.collateralAsset,
            p.debtAsset,
            amount,
            collateralReceived,
            profit
        );

        return true;
    }

    // ── Owner withdrawals ─────────────────────────────────────────────────────

    /// @notice Withdraw accumulated profit in any ERC-20 token.
    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner, balance);
    }

    /// @notice Withdraw any ETH sent to this contract.
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}
