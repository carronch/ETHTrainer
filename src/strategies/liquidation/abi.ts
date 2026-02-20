// ABIs for the liquidation bot system.
// LiquidationBot ABI is derived from contracts/LiquidationBot.sol.
// Aave and Uniswap ABIs cover only the functions we call.

// ── Our deployed contract ─────────────────────────────────────────────────────

export const LIQUIDATION_BOT_ABI = [
  {
    name: 'liquidate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralAsset',   type: 'address' },
      { name: 'debtAsset',         type: 'address' },
      { name: 'userToLiquidate',   type: 'address' },
      { name: 'debtToCover',       type: 'uint256' },
      { name: 'uniswapPoolFee',    type: 'uint24'  },
      { name: 'minProfitWei',      type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
  {
    name: 'withdrawETH',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'LiquidationExecuted',
    type: 'event',
    inputs: [
      { name: 'borrower',           type: 'address', indexed: true  },
      { name: 'collateralAsset',    type: 'address', indexed: false },
      { name: 'debtAsset',          type: 'address', indexed: false },
      { name: 'debtCovered',        type: 'uint256', indexed: false },
      { name: 'collateralReceived', type: 'uint256', indexed: false },
      { name: 'profit',             type: 'uint256', indexed: false },
    ],
  },
] as const

// ── Aave v3 Pool ──────────────────────────────────────────────────────────────

export const AAVE_POOL_ABI = [
  {
    name: 'getUserAccountData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase',          type: 'uint256' },
      { name: 'totalDebtBase',                type: 'uint256' },
      { name: 'availableBorrowsBase',         type: 'uint256' },
      { name: 'currentLiquidationThreshold',  type: 'uint256' },
      { name: 'ltv',                          type: 'uint256' },
      { name: 'healthFactor',                 type: 'uint256' },
    ],
  },
  {
    name: 'getReservesList',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    // Borrow event — emitted when a user borrows. We use this to populate the watchlist.
    name: 'Borrow',
    type: 'event',
    inputs: [
      { name: 'reserve',          type: 'address', indexed: true  },
      { name: 'user',             type: 'address', indexed: false },
      { name: 'onBehalfOf',       type: 'address', indexed: true  },
      { name: 'amount',           type: 'uint256', indexed: false },
      { name: 'interestRateMode', type: 'uint8',   indexed: false },
      { name: 'borrowRate',       type: 'uint256', indexed: false },
      { name: 'referralCode',     type: 'uint16',  indexed: true  },
    ],
  },
] as const

// ── Aave v3 PoolDataProvider ──────────────────────────────────────────────────

export const AAVE_DATA_PROVIDER_ABI = [
  {
    name: 'getUserReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'user',  type: 'address' },
    ],
    outputs: [
      { name: 'currentATokenBalance',    type: 'uint256' },
      { name: 'currentStableDebt',       type: 'uint256' },
      { name: 'currentVariableDebt',     type: 'uint256' },
      { name: 'principalStableDebt',     type: 'uint256' },
      { name: 'scaledVariableDebt',      type: 'uint256' },
      { name: 'stableBorrowRate',        type: 'uint256' },
      { name: 'liquidityRate',           type: 'uint256' },
      { name: 'stableRateLastUpdated',   type: 'uint40'  },
      { name: 'usageAsCollateralEnabled',type: 'bool'    },
    ],
  },
  {
    name: 'getReserveConfigurationData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'decimals',                 type: 'uint256' },
      { name: 'ltv',                      type: 'uint256' },
      { name: 'liquidationThreshold',     type: 'uint256' },
      { name: 'liquidationBonus',         type: 'uint256' }, // e.g. 10500 = 5% bonus
      { name: 'reserveFactor',            type: 'uint256' },
      { name: 'usageAsCollateralEnabled', type: 'bool'    },
      { name: 'borrowingEnabled',         type: 'bool'    },
      { name: 'stableBorrowRateEnabled',  type: 'bool'    },
      { name: 'isActive',                 type: 'bool'    },
      { name: 'isFrozen',                 type: 'bool'    },
    ],
  },
] as const

// ── Aave v3 Oracle ────────────────────────────────────────────────────────────

export const AAVE_ORACLE_ABI = [
  {
    name: 'getAssetPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],  // USD, 8 decimals
  },
  {
    name: 'getAssetsPrices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'address[]' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const

// ── Lido ──────────────────────────────────────────────────────────────────────

export const LIDO_ABI = [
  {
    name: 'submit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'referral', type: 'address' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ── Curve stETH/ETH pool ──────────────────────────────────────────────────────

export const CURVE_STETH_POOL_ABI = [
  {
    name: 'exchange',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'i',          type: 'int128'  }, // 0 = ETH, 1 = stETH
      { name: 'j',          type: 'int128'  },
      { name: 'dx',         type: 'uint256' },
      { name: 'min_dy',     type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'get_dy',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'i',  type: 'int128'  },
      { name: 'j',  type: 'int128'  },
      { name: 'dx', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
