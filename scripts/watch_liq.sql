.mode column
.headers on
SELECT 
  network,
  substr(address,1,10) AS addr,
  ROUND(CAST(last_health_factor AS REAL)/1e18, 5) AS hf,
  ROUND((CAST(last_health_factor AS REAL)/1e18 - 1) / (CAST(last_health_factor AS REAL)/1e18) * 100, 3) AS pct_drop_to_liq,
  ROUND(total_debt_usd, 0) AS debt_usd,
  datetime(updated_at,'unixepoch', 'localtime') AS last_checked
FROM liquidation_watchlist
WHERE network IN ('arbitrum', 'base', 'optimism') 
  AND is_active=1
  AND last_health_factor IS NOT NULL
  AND CAST(last_health_factor AS REAL) BETWEEN 0.9e18 AND 1.05e18
  AND total_debt_usd > 10
ORDER BY CAST(last_health_factor AS REAL) ASC
LIMIT 15;
