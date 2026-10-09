import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, ChevronRight, Radio, RefreshCw, ScanLine, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDerivScanner } from '@/hooks/use-deriv-scanner';
import type { Analysis, StrategyId } from '@/hooks/use-deriv-scanner';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const strategies = [
  { id: 'matches-differs', label: 'Matches & Differs', detail: 'Last digit repeats or changes' },
  { id: 'even-odd', label: 'Even & Odd', detail: 'Parity of the last digit' },
  { id: 'over-under', label: 'Over & Under', detail: 'Last digit relative to a barrier' },
  { id: 'rise-fall', label: 'Rise & Fall', detail: 'Tick-to-tick direction' },
] as const;

function connectionPresentation(status: string) {
  switch (status) {
    case 'connected': return { label: 'Live connection', kind: 'live', detail: 'Receiving tick stream' };
    case 'loading-markets': return { label: 'Loading markets', kind: 'wait', detail: 'Fetching active synthetic indices' };
    case 'connecting': return { label: 'Connecting', kind: 'wait', detail: 'Opening public market feed' };
    case 'reconnecting': return { label: 'Reconnecting', kind: 'wait', detail: 'Attempting to restore feed' };
    case 'error': return { label: 'Connection error', kind: 'down', detail: 'Market feed unavailable' };
    default: return { label: 'Not connected', kind: 'idle', detail: 'Waiting for market feed' };
  }
}

function formatQuote(value: number, precision: number) {
  const digits = Number.isFinite(precision) ? Math.max(0, Math.min(10, Math.trunc(precision))) : 2;
  return Number(value).toFixed(digits);
}

function formatTickTime(epoch: number) {
  const date = new Date(epoch * 1000);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZoneName: 'short',
  }).format(date);
}


function AnalysisDashboard({
  analysis,
  isAnalyzing,
  error,
  marketName,
  symbol,
  strategyName,
  latestTick,
  onClose,
  onRetry,
  scanRunId,
}: {
  analysis: Analysis | null;
  isAnalyzing: boolean;
  error: string | null;
  marketName: string;
  symbol: string;
  strategyName: string;
  latestTick?: { quote: number; epoch: number; pipSize: number; lastDigit: number | null };
  onClose: () => void;
  onRetry: () => void;
  scanRunId: number;
}) {
  const [minimumScanElapsed, setMinimumScanElapsed] = useState(false);
  const [refreshCountdown, setRefreshCountdown] = useState(30);
  const showScanning = isAnalyzing || !minimumScanElapsed;

  useEffect(() => {
    setMinimumScanElapsed(false);
    setRefreshCountdown(30);
    const timeout = setTimeout(() => setMinimumScanElapsed(true), 3000);
    return () => clearTimeout(timeout);
  }, [scanRunId]);

  useEffect(() => {
    if (!analysis || showScanning) return;

    if (refreshCountdown === 0) {
      onRetry();
      return;
    }

    const timeout = setTimeout(() => setRefreshCountdown((current) => current - 1), 1000);
    return () => clearTimeout(timeout);
  }, [analysis, onRetry, refreshCountdown, showScanning]);

  const leadingOutcome = analysis?.sampleSize
    ? analysis.outcomes
    .slice()
    .sort((first, second) => second.rate - first.rate)[0]
    : undefined;
  const isMatchesStrategy = analysis?.title === 'Matches & Differs';
  const rankedMatchEstimates = analysis?.sampleSize
    ? analysis.conditionalMatchesByDigit
    .slice()
    .sort((first, second) =>
      second.estimate - first.estimate
      || second.sampleSize - first.sampleSize
      || first.digit - second.digit,
    )
    : [];
  const bestMatchEstimate = rankedMatchEstimates[0];
  const recommendationDigit = isMatchesStrategy
    ? bestMatchEstimate?.digit ?? latestTick?.lastDigit ?? analysis?.recommendedDigit
    : analysis?.recommendedDigit;
  const conditionalMatch = recommendationDigit === undefined
    ? undefined
    : analysis?.conditionalMatchesByDigit.find((item) => item.digit === recommendationDigit);
  const matchRate = conditionalMatch
    ? conditionalMatch.estimate
    : leadingOutcome?.rate ?? 0;
  const matchCount = conditionalMatch
    ? conditionalMatch.count
    : leadingOutcome?.count ?? 0;
  const matchSampleSize = conditionalMatch
    ? conditionalMatch.sampleSize
    : analysis?.sampleSize ?? 0;
  const isOverUnderStrategy = analysis?.title === 'Over & Under';
  const isEvenOddStrategy = analysis?.title === 'Even & Odd';
  const entryDigits = isMatchesStrategy
    ? rankedMatchEstimates.slice(0, 3).map((candidate) => ({
      digit: candidate.digit,
      count: candidate.count,
      rate: candidate.estimate,
    }))
    : analysis?.digitFrequencies
      .filter((digit) => {
      if (leadingOutcome?.acceptedDigits) {
        return leadingOutcome.acceptedDigits.includes(digit.digit);
      }
      if (isEvenOddStrategy && leadingOutcome) {
        return leadingOutcome.label === 'Even' ? digit.digit % 2 === 0 : digit.digit % 2 !== 0;
      }
      return false;
    })
      .slice(0, 3) ?? [];

  return (
    <div
      className="analysis-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="analysis-terminal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-dialog-title"
        data-testid="analysis-dashboard"
      >
        <div className="analysis-terminal-bar">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="analysis-light analysis-light-red" />
            <span className="analysis-light analysis-light-yellow" />
            <span className="analysis-light analysis-light-green" />
          </div>
          <h2 id="analysis-dialog-title" className="min-w-0 truncate text-[11px] font-semibold text-[#a4ff1a] sm:text-[13px]">
            Analysis Dashboard · {strategyName} on {symbol}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close analysis dashboard"
            className="analysis-close"
            data-testid="button-close-analysis"
          >
            <X size={14} />
          </button>
        </div>
        <div className="analysis-terminal-body">
          {showScanning ? (
            <div className="analysis-scan-state" role="status" aria-live="polite" data-testid="analysis-status">
              <span className="analysis-scan-orb" aria-hidden="true"><span /></span>
              <div className="min-w-0 flex-1">
                <p className="analysis-scan-title">Scanning market data…</p>
                <p className="mt-1 text-[10px] text-[#96aaa1]">Fetching recent ticks and evaluating {strategyName} on {symbol}.</p>
                <div className="analysis-scan-track mt-3" aria-hidden="true"><span /></div>
              </div>
            </div>
          ) : (
            <p className={error && !analysis ? 'text-[#ff6969]' : 'text-[#a4ff1a]'} aria-live="polite" data-testid="analysis-status">
              {analysis ? 'Analysis complete!' : error || 'No analysis data returned.'}
            </p>
          )}
          <p className="mt-1 text-[#929ea9]">Market: {marketName} ({symbol})</p>
          {latestTick && (
            <p className="mt-1 text-[#d8e2df]">
              Latest quote: {formatQuote(latestTick.quote, latestTick.pipSize)}
              {' · '}Last digit: {latestTick.lastDigit ?? '—'}
              {' · '}{formatTickTime(latestTick.epoch)}
            </p>
          )}
          {analysis && !showScanning && (
            <>
              <div className="analysis-readout mt-4" data-testid="analysis-strategy-result">
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#92a39d]">
                  {isMatchesStrategy
                    ? 'PREDICTION · MATCHES'
                    : isOverUnderStrategy
                      ? 'PREDICTION · SELECTED OVER/UNDER CONTRACT'
                      : 'PREDICTION · LEADING STRATEGY OUTCOME'}
                </p>
                {leadingOutcome ? (
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[#e4eae8]">
                      {isMatchesStrategy ? `Matches ${recommendationDigit ?? '—'}` : leadingOutcome.label}
                    </span>
                    <span className="mono text-[14px] font-bold text-[#a4ff1a]">
                      {(isMatchesStrategy ? matchRate : leadingOutcome.rate).toFixed(1)}% estimated likelihood
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-[#c4cdd1]">Not enough data to calculate a strategy result.</p>
                )}
                {leadingOutcome && (
                  <p className="mt-1 text-[10px] text-[#9ea9a5]">
                    {isMatchesStrategy
                      ? conditionalMatch
                        ? `${matchCount} of ${matchSampleSize} recent transitions repeated digit ${recommendationDigit}; estimate smoothed with overall match rate`
                        : `${matchCount} of ${matchSampleSize} overall matches; no digit-specific history`
                      : `${leadingOutcome.count} of ${analysis.sampleSize} recent observations · ${analysis.title}`}
                  </p>
                )}
                {isOverUnderStrategy && (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/[.07] pt-2 sm:grid-cols-3">
                    {analysis.sampleSize > 0 ? analysis.outcomes.map((outcome) => (
                      <p key={outcome.label} className="flex justify-between gap-2 text-[9px] text-[#9ea9a5]">
                        <span>{outcome.label}</span>
                        <span className="mono text-[#7ce1c2]">{outcome.rate.toFixed(1)}%</span>
                      </p>
                    )) : <p className="col-span-full text-[10px] text-[#9ea9a5]">Not enough tick data to compare barriers.</p>}
                  </div>
                )}
              </div>
              <div className="analysis-readout mt-4" data-testid="analysis-entry-points">
                <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#92a39d]">
                  {isMatchesStrategy
                    ? 'ENTRY POINTS · TOP 3 MATCH ESTIMATES'
                    : isOverUnderStrategy || isEvenOddStrategy
                      ? 'ENTRY POINTS · TOP QUALIFYING DIGITS'
                      : 'ENTRY POINT · PRICE DIRECTION'}
                </p>
                {isMatchesStrategy && recommendationDigit !== undefined && (
                  <p className="mt-2 text-[10px] text-[#9ea9a5]">
                    Matches target: <span className="mono font-bold text-[#a4ff1a]">{recommendationDigit}</span>
                    {' '}· selected for the highest smoothed match estimate.
                  </p>
                )}
                {entryDigits.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {entryDigits.map((digit, index) => (
                      <div key={digit.digit} className="rounded-md border border-white/[.08] bg-black/20 px-2 py-2 text-center">
                        <p className="text-[9px] text-[#9ea9a5]">#{index + 1} · digit</p>
                        <p className="mono text-[20px] font-bold leading-tight text-[#a4ff1a]">{digit.digit}</p>
                        <p className="mono mt-1 text-[9px] text-[#7ce1c2]">
                          {digit.rate.toFixed(1)}% {isMatchesStrategy ? 'estimated likelihood' : 'recent frequency'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-[#c4cdd1]">
                    {isMatchesStrategy
                      ? 'Not enough tick data to rank entry digits.'
                      : isOverUnderStrategy || isEvenOddStrategy
                        ? 'Not enough tick data to rank qualifying entry digits.'
                        : 'Rise/Fall is a price-direction prediction; it does not use digit entry points.'}
                  </p>
                )}
              </div>
              <div className="analysis-countdown mt-4" role="timer" aria-live="off" data-testid="analysis-countdown">
                <span className="analysis-countdown-ring" aria-hidden="true" />
                <span>Next market-data analysis refresh in</span>
                <strong className="mono text-[#a4ff1a]">00:{String(refreshCountdown).padStart(2, '0')}</strong>
              </div>
              <p className="mt-4 border-l-2 border-[#a4ff1a]/45 pl-3 text-[10px] leading-relaxed text-[#aeb8b3]">
                {isMatchesStrategy && 'Only Matches is evaluated. Each candidate digit is scored by its smoothed historical chance of repeating after that digit appeared; the highest estimate is shown. '}
                {analysis.note} The estimate is not guaranteed.
              </p>
            </>
          )}
          {!isAnalyzing && !analysis && (
            <button type="button" onClick={onRetry} className="mt-4 rounded-md bg-[#159f23] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#18b22a]">
              Retry analysis
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ScannerScreen() {
  const scanner = useDerivScanner();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisRunId, setAnalysisRunId] = useState(0);
  const status = connectionPresentation(scanner.connectionStatus);
  const activeMarket = scanner.markets.find((market) => market.symbol === scanner.selectedMarket);
  const invalidSelection = Boolean(scanner.selectedMarket) && !activeMarket && scanner.markets.length > 0;
  const latestTick = scanner.ticks.length ? scanner.ticks[scanner.ticks.length - 1] : undefined;
  const precision = latestTick?.pipSize ?? activeMarket?.pipSize ?? 2;
  const hasFeedAlert = Boolean(scanner.error) || scanner.connectionStatus === 'error';
  const canAnalyze = scanner.connectionStatus === 'connected'
    && Boolean(activeMarket)
    && !scanner.isAnalyzing;

  const alertTitle = scanner.connectionStatus === 'error'
    ? 'Market data connection failed'
    : 'Market feed is reconnecting';

  useEffect(() => {
    if (!analysisOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAnalysisOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [analysisOpen]);

  const startAnalysis = useCallback(() => {
    setAnalysisRunId((runId) => runId + 1);
    setAnalysisOpen(true);
    scanner.analyze();
  }, [scanner.analyze]);

  return (
    <div className="scanner-shell">
      <div className="terminal-backdrop" aria-hidden="true">
        {'[INFO] Connecting to public feed... [OK] Data stream established... [INFO] Fetching market data... [INFO] Analysing volatility index... [SUCCESS] Tick received... [SECURITY] Read-only session... '}
        {'[INFO] Connecting to public feed... [OK] Data stream established... [INFO] Fetching market data... [INFO] Analysing volatility index... [SUCCESS] Tick received... [SECURITY] Read-only session... '}
        {'[INFO] Connecting to public feed... [OK] Data stream established... [INFO] Fetching market data... [INFO] Analysing volatility index... [SUCCESS] Tick received... [SECURITY] Read-only session... '}
        {'[INFO] Connecting to public feed... [OK] Data stream established... [INFO] Fetching market data... [INFO] Analysing volatility index... [SUCCESS] Tick received... [SECURITY] Read-only session... '}
        {'[INFO] Connecting to public feed... [OK] Data stream established... [INFO] Fetching market data... [INFO] Analysing volatility index... [SUCCESS] Tick received... [SECURITY] Read-only session... '}
      </div>
      <header className="border-b border-white/[0.08] bg-[#141a22]/90">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-4 py-4 sm:px-7 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e9bd4d]/25 bg-[#e9bd4d]/[0.09] text-[#e9bd4d]">
              <ScanLine size={19} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-extrabold tracking-[-.035em] text-[#f0f2f5] sm:text-[17px]">DBOT-PULSE SCANNER</h1>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[.15em] text-[#798493]">Powered by dbotpulse.site</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {scanner.connectionStatus === 'idle' && !scanner.error && (
              <button type="button" onClick={scanner.reconnect} aria-label="Connect to public market feed" className="flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2 text-[10px] font-bold text-[#c6ced7] transition hover:bg-white/[0.06] sm:px-3" data-testid="button-connect">
                <RefreshCw size={12} /> <span className="hidden sm:inline">Connect</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-8 pt-5 sm:px-7 sm:pt-7 lg:px-9">
        {hasFeedAlert && (
          <section className="mb-4 flex flex-col gap-3 rounded-xl border border-[#db716c]/25 bg-[#db716c]/[0.07] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="status-api-error">
            <div className="flex items-start gap-3">
              <AlertCircle size={17} className="mt-0.5 shrink-0 text-[#df827b]" />
              <div>
                <p className="text-[12px] font-bold text-[#e3e6ea]">{alertTitle}</p>
                <p className="mt-1 break-words text-[11px] leading-relaxed text-[#a0a9b5]">
                  {scanner.error || 'The public market data service is unavailable. Try reconnecting.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={scanner.reconnect}
              disabled={scanner.connectionStatus === 'reconnecting'}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-white/10 bg-white/[0.045] px-3 text-[11px] font-bold text-[#d5dbe2] transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45 sm:self-center"
              data-testid="button-reconnect"
            >
              <RefreshCw size={13} className={scanner.connectionStatus === 'reconnecting' ? 'animate-spin' : ''} />
              Reconnect
            </button>
          </section>
        )}

        <section className="terminal-console mx-auto mb-5 max-w-[700px] rounded-[18px] p-5 sm:p-8" aria-labelledby="console-title">
          <div className="mb-6 text-center">
            <div className="terminal-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl">
              <ScanLine size={24} />
            </div>
            <h2 id="console-title" className="terminal-title text-[25px] font-extrabold tracking-[-.04em] sm:text-[31px]">DBOT-PULSE SCANNER</h2>
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[.2em] text-[#7eaaa0]">Read-only · Synthetic market intelligence</p>
          </div>
          <div className="mx-auto max-w-[520px] space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-center text-[11px] font-semibold text-[#d5e3d9]">Select Strategy</span>
              <select
                aria-label="Select strategy"
                value={scanner.selectedStrategy}
                onChange={(event) => scanner.setSelectedStrategy(event.target.value as StrategyId)}
                className="terminal-select native-select min-h-11 w-full rounded-lg px-3.5 pr-10 text-center text-[13px] font-semibold outline-none"
                data-testid="select-strategy"
              >
                {strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-center text-[11px] font-semibold text-[#d5e3d9]">Select Market</span>
              <select
                aria-label="Select market"
                value={scanner.selectedMarket}
                onChange={(event) => scanner.setSelectedMarket(event.target.value)}
                disabled={scanner.markets.length === 0}
                className="terminal-select native-select min-h-11 w-full rounded-lg px-3.5 pr-10 text-center text-[13px] font-semibold outline-none disabled:opacity-50"
                data-testid="select-market"
              >
                <option value="">{scanner.markets.length ? 'Choose a market' : 'Loading active markets…'}</option>
                {scanner.markets.map((market) => <option key={market.symbol} value={market.symbol}>{market.displayName} · {market.symbol}</option>)}
              </select>
            </label>
            <div className="terminal-quote-grid grid grid-cols-2 gap-2 rounded-xl px-3 py-4 sm:gap-3 sm:px-5 sm:py-5">
              <div>
                <p className="terminal-glow-label text-[10px] font-semibold uppercase tracking-[.12em]">Latest Tick</p>
                <p className="mono terminal-glow-value mt-1 truncate text-[clamp(1.5rem,5vw,2.1rem)] font-medium" data-testid="text-latest-quote" aria-live="polite">
                  {latestTick ? formatQuote(latestTick.quote, precision) : '—'}
                </p>
                <p className="mt-1 text-[9px] text-[#609082]">{activeMarket?.displayName ?? 'Waiting for market'}</p>
              </div>
              <div className="text-right">
                <p className="terminal-glow-label text-[10px] font-semibold uppercase tracking-[.12em]">Last Digit</p>
                <p className="mono terminal-glow-value mt-1 text-[clamp(1.5rem,5vw,2.1rem)] font-medium" data-testid="text-last-digit">
                  {latestTick?.lastDigit ?? '—'}
                </p>
                <p className="mt-1 text-[9px] text-[#609082]">{latestTick ? `${precision} decimal places` : 'Waiting for first tick'}</p>
              </div>
              <div className="col-span-2 flex items-center justify-center gap-1.5 border-t border-[#26f4c8]/10 pt-2 text-[9px] text-[#85a89c]">
                <span className={`status-dot ${status.kind}`} />
                {status.label} · {latestTick ? formatTickTime(latestTick.epoch) : status.detail}
              </div>
            </div>
            <button
              type="button"
              onClick={startAnalysis}
              disabled={!canAnalyze}
              className="terminal-analyse mx-auto flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-lg px-5 text-[12px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-analyze"
            >
              {scanner.isAnalyzing ? <><RefreshCw size={14} className="animate-spin" /> Analysing…</> : <>Analyse <ChevronRight size={14} /></>}
            </button>
            {invalidSelection && <p className="text-center text-[10px] text-[#e6bc55]">Choose an active market before analysing.</p>}
          </div>
          <p className="mt-5 text-center text-[9px] text-[#6e8b83]">Historical analysis only — no trades are executed.</p>
        </section>

        <footer className="px-1 pb-2 pt-5 text-center text-[9px] tracking-[.03em] text-[#5f6a77]">
          Powered by DBOT-PULSE · Created by ONGAKI JR
        </footer>
      </main>
      {analysisOpen && (
        <AnalysisDashboard
          analysis={scanner.analysis}
          isAnalyzing={scanner.isAnalyzing}
          error={scanner.error}
          marketName={activeMarket?.displayName ?? 'Unavailable market'}
          symbol={scanner.selectedMarket || '—'}
          strategyName={strategies.find((strategy) => strategy.id === scanner.selectedStrategy)?.label ?? 'Selected strategy'}
          latestTick={latestTick}
          onClose={() => setAnalysisOpen(false)}
          onRetry={startAnalysis}
          scanRunId={analysisRunId}
        />
      )}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/signals" component={ScannerScreen} />
        <Route path="/" component={ScannerScreen} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
