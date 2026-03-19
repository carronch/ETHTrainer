// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAavePool, IFlashLoanSimpleReceiver} from "./interfaces/IAavePool.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @title LiquidationBot
/// @notice Executes Aave v3 liquidations using flash loans.
///         Supports two modes:
///           - Single: flash loan one position → liquidationCall → swap → repay
///           - Batch:  flash loan sum of debts → liquidate N positions → swap each → repay
///         Owner calls withdraw() to collect profits.
/// @dev Only owner can initiate. Uses Uniswap v3 SwapRouter02 (no deadline).
///      Flash loan params are prefixed with a 1-byte opType to route to the correct handler:
///        0x00 = single liquidation
///        0x01 = batch liquidation
contract LiquidationBot is IFlashLoanSimpleReceiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public immutable pool;      // Aave v3 Pool
    address public immutable router;    // Uniswap v3 SwapRouter02

    // ── Op types ──────────────────────────────────────────────────────────────

    uint8 private constant OP_SINGLE = 0;
    uint8 private constant OP_BATCH  = 1;

    // ── Param structs ─────────────────────────────────────────────────────────

    struct LiquidationParams {
        address collateralAsset;
        address debtAsset;
        address userToLiquidate;
        uint24  uniswapPoolFee;
        uint256 minProfitWei;   // minimum profit in debtAsset units; reverts if not met
    }

    /// @dev One position in a batch.
    struct BatchPositionParams {
        address collateralAsset;
        address userToLiquidate;
        uint256 debtToCover;
        uint24  uniswapPoolFee;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event LiquidationExecuted(
        address indexed borrower,
        address collateralAsset,
        address debtAsset,
        uint256 debtCovered,
        uint256 collateralReceived,
        uint256 profit
    );

    event BatchLiquidationExecuted(
        address indexed debtAsset,
        uint256 positionCount,
        uint256 totalDebtCovered,
        uint256 totalProfit
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotOwner();
    error NotPool();
    error NotSelf();
    error UnknownOpType(uint8 opType);
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

    // ── Single liquidation ────────────────────────────────────────────────────

    /// @notice Initiate a flash-loan-backed liquidation of a single position.
    /// @param collateralAsset  The asset to seize from the borrower.
    /// @param debtAsset        The asset to repay on behalf of the borrower.
    /// @param userToLiquidate  The underwater borrower address.
    /// @param debtToCover      Amount of debt to repay (exact amount, matched to flash loan size).
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
        bytes memory innerParams = abi.encode(LiquidationParams({
            collateralAsset:   collateralAsset,
            debtAsset:         debtAsset,
            userToLiquidate:   userToLiquidate,
            uniswapPoolFee:    uniswapPoolFee,
            minProfitWei:      minProfitWei
        }));
        // Prepend opType byte so executeOperation can route correctly
        bytes memory params = abi.encodePacked(uint8(OP_SINGLE), innerParams);

        IAavePool(pool).flashLoanSimple(
            address(this),  // receiver
            debtAsset,      // asset to borrow
            debtToCover,    // amount to borrow
            params,
            0               // referralCode
        );
    }

    // ── Batch liquidation ─────────────────────────────────────────────────────

    /// @notice Initiate a flash-loan-backed batch liquidation.
    ///         All positions must share the same debt asset.
    ///         Total flash loan = sum of all debtToCover values.
    ///         Each position's collateral is swapped back to the debt asset.
    ///         The aggregate profit check (minTotalProfitWei) protects against slippage.
    /// @param debtAsset         Shared debt asset for all positions.
    /// @param positions         Array of positions to liquidate.
    /// @param minTotalProfitWei Minimum total profit across all swaps. Reverts if not met.
    function batchLiquidate(
        address debtAsset,
        BatchPositionParams[] calldata positions,
        uint256 minTotalProfitWei
    ) external onlyOwner {
        uint256 totalDebt = 0;
        for (uint256 i = 0; i < positions.length; i++) {
            totalDebt += positions[i].debtToCover;
        }

        bytes memory innerParams = abi.encode(debtAsset, positions, minTotalProfitWei);
        bytes memory params = abi.encodePacked(uint8(OP_BATCH), innerParams);

        IAavePool(pool).flashLoanSimple(
            address(this),
            debtAsset,
            totalDebt,
            params,
            0
        );
    }

    // ── Flash loan callback ───────────────────────────────────────────────────

    /// @notice Aave callback — called after flash loan is disbursed.
    ///         Routes to single or batch handler based on opType prefix byte.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override nonReentrant returns (bool) {
        // Security: only Aave Pool can call; only this contract can initiate
        if (msg.sender != pool)          revert NotPool();
        if (initiator != address(this))  revert NotSelf();

        uint8 opType = uint8(params[0]);
        bytes calldata innerParams = params[1:];

        if (opType == OP_SINGLE) {
            _executeSingle(asset, amount, premium, innerParams);
        } else if (opType == OP_BATCH) {
            _executeBatch(asset, amount, premium, innerParams);
        } else {
            revert UnknownOpType(opType);
        }

        return true;
    }

    // ── Internal: single liquidation ──────────────────────────────────────────

    function _executeSingle(
        address asset,
        uint256 amount,
        uint256 premium,
        bytes calldata innerParams
    ) internal {
        LiquidationParams memory p = abi.decode(innerParams, (LiquidationParams));

        // 1. Approve Pool to pull the debt asset for liquidation
        IERC20(asset).forceApprove(pool, amount);

        // 2. Execute liquidation — seize collateral, repay debt
        uint256 collateralBefore = IERC20(p.collateralAsset).balanceOf(address(this));
        IAavePool(pool).liquidationCall(
            p.collateralAsset,
            p.debtAsset,
            p.userToLiquidate,
            amount,             // exact flash loan amount — matches forceApprove above
            false               // receive underlying token, not aToken
        );
        uint256 collateralReceived = IERC20(p.collateralAsset).balanceOf(address(this)) - collateralBefore;

        // 3. Swap collateral → debt asset (if they differ)
        if (p.collateralAsset != p.debtAsset && collateralReceived > 0) {
            uint256 repaymentDue = amount + premium;
            uint256 leftover = IERC20(asset).balanceOf(address(this));
            uint256 target = repaymentDue + p.minProfitWei;
            uint256 requiredFromSwap = target > leftover ? target - leftover : 0;

            IERC20(p.collateralAsset).forceApprove(router, collateralReceived);
            ISwapRouter(router).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           p.collateralAsset,
                    tokenOut:          p.debtAsset,
                    fee:               p.uniswapPoolFee,
                    recipient:         address(this),
                    amountIn:          collateralReceived,
                    amountOutMinimum:  requiredFromSwap,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // 4. Profit check + repay
        uint256 repayment = amount + premium;
        uint256 debtBalance = IERC20(asset).balanceOf(address(this));
        if (debtBalance < repayment + p.minProfitWei) {
            revert InsufficientProfit(
                debtBalance > repayment ? debtBalance - repayment : 0,
                p.minProfitWei
            );
        }
        IERC20(asset).forceApprove(pool, repayment);

        emit LiquidationExecuted(
            p.userToLiquidate,
            p.collateralAsset,
            p.debtAsset,
            amount,
            collateralReceived,
            debtBalance - repayment
        );
    }

    // ── Internal: batch liquidation ───────────────────────────────────────────

    function _executeBatch(
        address asset,
        uint256 totalAmount,
        uint256 premium,
        bytes calldata innerParams
    ) internal {
        (
            address debtAsset,
            BatchPositionParams[] memory positions,
            uint256 minTotalProfitWei
        ) = abi.decode(innerParams, (address, BatchPositionParams[], uint256));

        // Approve pool for the entire flash loan amount upfront
        // Each liquidationCall will pull exactly p.debtToCover from this approval
        IERC20(debtAsset).forceApprove(pool, totalAmount);

        // 1. Liquidate each position, track collateral received per asset
        address[] memory collaterals = new address[](positions.length);
        uint256[] memory collateralAmounts = new uint256[](positions.length);

        for (uint256 i = 0; i < positions.length; i++) {
            BatchPositionParams memory p = positions[i];
            uint256 before = IERC20(p.collateralAsset).balanceOf(address(this));
            IAavePool(pool).liquidationCall(
                p.collateralAsset,
                debtAsset,
                p.userToLiquidate,
                p.debtToCover,
                false   // receive underlying, not aToken
            );
            collaterals[i]       = p.collateralAsset;
            collateralAmounts[i] = IERC20(p.collateralAsset).balanceOf(address(this)) - before;
        }

        // 2. Swap each collateral type back to the debt asset.
        //    amountOutMinimum = debtToCover for that position: each swap must recoup at
        //    minimum the debt used, so no individual position can be a net loss.
        //    Profit from the liquidation bonus is collected by the aggregate check below.
        for (uint256 i = 0; i < positions.length; i++) {
            if (collaterals[i] == debtAsset || collateralAmounts[i] == 0) continue;
            IERC20(collaterals[i]).forceApprove(router, collateralAmounts[i]);
            ISwapRouter(router).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           collaterals[i],
                    tokenOut:          debtAsset,
                    fee:               positions[i].uniswapPoolFee,
                    recipient:         address(this),
                    amountIn:          collateralAmounts[i],
                    amountOutMinimum:  positions[i].debtToCover,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // 3. Aggregate profit check — protects against excessive slippage across the batch
        uint256 repayment    = totalAmount + premium;
        uint256 debtBalance  = IERC20(debtAsset).balanceOf(address(this));
        if (debtBalance < repayment + minTotalProfitWei) {
            revert InsufficientProfit(
                debtBalance > repayment ? debtBalance - repayment : 0,
                minTotalProfitWei
            );
        }

        // 4. Repay flash loan
        IERC20(debtAsset).forceApprove(pool, repayment);

        emit BatchLiquidationExecuted(
            debtAsset,
            positions.length,
            totalAmount,
            debtBalance - repayment
        );
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
