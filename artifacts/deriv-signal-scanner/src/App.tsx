import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, BarChart3, Cable, Check, ChevronRight, Clock3, Radio, RefreshCw, ScanLine, ShieldAlert, Waves } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDerivScanner } from '@/hooks/use-deriv-scanner';
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

function ScannerScreen() {
  const scanner = useDerivScanner();
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

  return (
    <div className="scanner-shell">
      <header className="border-b border-white/[0.08] bg-[#141a22]/90">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-4 py-4 sm:px-7 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e9bd4d]/25 bg-[#e9bd4d]/[0.09] text-[#e9bd4d]">
              <ScanLine size={19} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-extrabold tracking-[-.035em] text-[#f0f2f5] sm:text-[17px]">Deriv Signal Scanner</h1>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[.15em] text-[#798493]">Synthetic indices · Tick intelligence</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-2 sm:gap-2.5 sm:px-3" aria-live="polite" data-testid="status-connection">
              <span className={`status-dot ${status.kind}`} />
              <span className="text-[10px] font-bold text-[#c7ced7] sm:text-[11px]">{status.label}</span>
            </div>
            {scanner.connectionStatus === 'idle' && !scanner.error && (
              <button type="button" onClick={scanner.reconnect} aria-label="Connect to public market feed" className="flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2 text-[10px] font-bold text-[#c6ced7] transition hover:bg-white/[0.06] sm:px-3" data-testid="button-connect">
                <RefreshCw size={12} /> <span className="hidden sm:inline">Connect</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-8 pt-5 sm:px-7 sm:pt-7 lg:px-9">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
          <div>
            <p className="eyebrow mb-1.5">Market observation</p>
            <h2 className="text-[21px] font-bold tracking-[-.045em] text-[#e8ebef] sm:text-[25px]">Live signal workspace</h2>
          </div>
          <div className="flex items-center gap-2 pb-0.5 text-[11px] text-[#818c9a]">
            <Radio size={14} className={scanner.connectionStatus === 'connected' ? 'text-[#61c69c]' : 'text-[#e9bd4d]'} />
            <span>{status.detail}</span>
          </div>
        </div>

        {hasFeedAlert && (
          <section className={`mb-4 flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between ${configMissing ? 'border-[#d5a943]/30 bg-[#d5a943]/[0.07]' : 'border-[#db716c]/25 bg-[#db716c]/[0.07]'}`} role="alert" data-testid="status-api-error">
            <div className="flex items-start gap-3">
              {configMissing ? <ShieldAlert size={17} className="mt-0.5 shrink-0 text-[#e7b94a]" /> : <AlertCircle size={17} className="mt-0.5 shrink-0 text-[#df827b]" />}
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(330px,.82fr)]">
          <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="setup-heading">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.045] text-[#c2cbd5]"><Waves size={16} /></div>
                <div>
                  <h3 id="setup-heading" className="text-[13px] font-bold text-[#e3e7ec]">Scan parameters</h3>
                  <p className="mt-0.5 text-[10px] text-[#818b98]">Choose a live market and calculation</p>
                </div>
              </div>
              <span className="eyebrow hidden sm:block">01 / Configure</span>
            </div>

            <label htmlFor="market-select" className="mb-2 block text-[10px] font-bold uppercase tracking-[.12em] text-[#929daa]">Synthetic market</label>
            <div className="relative">
              {scanner.connectionStatus === 'loading-markets' && scanner.markets.length === 0 ? (
                <div className="skeleton h-[46px] rounded-xl" aria-label="Loading markets" data-testid="skeleton-markets" />
              ) : (
                <select
                  id="market-select"
                  value={scanner.selectedMarket}
                  onChange={(event) => scanner.setSelectedMarket(event.target.value)}
                  disabled={scanner.markets.length === 0}
                  aria-invalid={invalidSelection}
                  aria-describedby="market-help"
                  className="native-select min-h-[46px] w-full rounded-xl border border-white/[0.11] bg-[#141a22] px-3.5 pr-10 text-[13px] font-semibold text-[#e3e7ec] outline-none transition focus:border-[#e9bd4d]/60 disabled:cursor-not-allowed disabled:opacity-55"
                  data-testid="select-market"
                >
                  <option value="">{scanner.markets.length ? 'Select an active market' : 'No active markets available'}</option>
                  {invalidSelection && <option value={scanner.selectedMarket}>Previously selected market · unavailable</option>}
                  {scanner.markets.map((market) => (
                    <option key={market.symbol} value={market.symbol}>{market.displayName}</option>
                  ))}
                </select>
              )}
            </div>
            <p id="market-help" className={`mt-2 min-h-[15px] text-[10px] ${invalidSelection ? 'text-[#e3ad55]' : 'text-[#778290]'}`} aria-live="polite" data-testid="text-market-state">
              {invalidSelection
                ? 'This selection is no longer active. Choose an available market.'
                : scanner.markets.length === 0 && scanner.connectionStatus !== 'loading-markets'
                  ? 'Active markets will appear here when the public feed is available.'
                  : activeMarket ? `Symbol ${activeMarket.symbol} · quote precision ${activeMarket.pipSize} decimal places` : 'Only markets returned by the live feed are listed.'}
            </p>

            <div className="mb-2 mt-5 flex items-center justify-between">
              <label className="block text-[10px] font-bold uppercase tracking-[.12em] text-[#929daa]">Digit strategy</label>
              <span className="text-[10px] text-[#717d8b]">Historical frequency</span>
            </div>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              {strategies.map((strategy, index) => {
                const selected = scanner.selectedStrategy === strategy.id;
                return (
                  <button
                    key={strategy.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => scanner.setSelectedStrategy(strategy.id)}
                    className={`group flex min-h-[60px] items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${selected ? 'border-[#e9bd4d]/40 bg-[#e9bd4d]/[0.075]' : 'border-white/[0.075] bg-white/[0.018] hover:border-white/[0.16] hover:bg-white/[0.04]'}`}
                    data-testid={`button-strategy-${strategy.id}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`mono text-[9px] ${selected ? 'text-[#e9bd4d]' : 'text-[#657180]'}`}>0{index + 1}</span>
                      <span className="min-w-0">
                        <span className={`block text-[12px] font-bold ${selected ? 'text-[#f0d78f]' : 'text-[#c6cdd6]'}`}>{strategy.label}</span>
                        <span className="mt-1 block truncate text-[9px] text-[#798493]">{strategy.detail}</span>
                      </span>
                    </span>
                    <span className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#e9bd4d] bg-[#e9bd4d] text-[#171b20]' : 'border-[#596370] text-transparent'}`}>
                      {selected && <Check size={11} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={scanner.analyze}
              disabled={!canAnalyze}
              className="mt-4 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#e9bd4d] px-4 text-[12px] font-extrabold tracking-[.01em] text-[#202018] transition hover:bg-[#f1ca61] disabled:cursor-not-allowed disabled:bg-[#75673e] disabled:text-[#d1c699]/70"
              data-testid="button-analyze"
            >
              {scanner.isAnalyzing ? <><RefreshCw size={15} className="animate-spin" /> Analysing tick history…</> : <>Analyse history <ChevronRight size={15} /></>}
            </button>
            {!activeMarket && scanner.markets.length > 0 && <p className="mt-2 text-center text-[10px] text-[#e2ae58]">Select a valid active market to analyse.</p>}
            <p className="mt-3 text-center text-[9px] leading-relaxed text-[#6f7a87]">Read-only public market data. No account access or trade execution.</p>
          </section>

          <section className="panel soft-grid relative overflow-hidden rounded-2xl p-4 sm:p-5" aria-labelledby="quote-heading">
            <div className="relative z-[1] flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5bc49a]/[0.09] text-[#67cda3]"><BarChart3 size={16} /></div>
                <div>
                  <h3 id="quote-heading" className="text-[13px] font-bold text-[#e3e7ec]">Latest market tick</h3>
                  <p className="mt-0.5 text-[10px] text-[#818b98]">{activeMarket?.displayName ?? (latestTick ? latestTick.symbol : 'Waiting for selected market')}</p>
                </div>
              </div>
              {latestTick && <span className="inline-flex items-center gap-1.5 rounded-full border border-[#5bc49a]/20 bg-[#5bc49a]/[0.07] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.1em] text-[#70cda7]"><span className="status-dot live !h-[5px] !w-[5px]" /> Latest</span>}
            </div>

            <div className="relative z-[1] mt-7 border-b border-white/[0.075] pb-5">
              <p className="eyebrow">Current quote</p>
              <div className="mono mt-2 flex min-h-[54px] items-end gap-2 overflow-hidden text-[clamp(1.9rem,6vw,3rem)] font-medium leading-none tracking-[-.06em] text-[#f1f3f5]" data-testid="text-latest-quote" aria-live="polite">
                {latestTick ? formatQuote(latestTick.quote, precision) : <span className="text-[15px] font-normal tracking-normal text-[#737e8b]">{scanner.connectionStatus === 'connected' ? 'Awaiting first tick' : '—'}</span>}
              </div>
              <p className="mono mt-2 text-[10px] text-[#7e8996]">{latestTick ? `${precision} decimal places · API quote precision` : 'No quote received'}</p>
            </div>
            <div className="relative z-[1] grid grid-cols-2 gap-3 pt-4">
              <div className="rounded-xl border border-white/[0.065] bg-[#111820]/60 px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-[#818b98]"><ScanLine size={12} /> Last digit</div>
                <div className="mono mt-2 text-[22px] font-medium leading-none text-[#e9bd4d]" data-testid="text-last-digit">{latestTick?.lastDigit ?? '—'}</div>
                <p className="mt-1.5 text-[9px] text-[#6e7986]">{latestTick?.lastDigit === null || !latestTick ? 'Not present in tick data' : 'From latest API tick'}</p>
              </div>
              <div className="rounded-xl border border-white/[0.065] bg-[#111820]/60 px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-[#818b98]"><Clock3 size={12} /> Tick time</div>
                <div className="mono mt-2 truncate text-[13px] font-medium leading-[22px] text-[#d9dfe5]" data-testid="text-tick-time">{latestTick ? formatTickTime(latestTick.epoch) : '—'}</div>
                <p className="mt-1.5 text-[9px] text-[#6e7986]">{latestTick ? 'Exchange timestamp' : 'Waiting for history'}</p>
              </div>
            </div>
            {!latestTick && (
              <div className="relative z-[1] mt-3 flex items-start gap-2 rounded-lg border border-white/[0.055] bg-white/[0.018] px-3 py-2.5">
                <Cable size={13} className="mt-0.5 shrink-0 text-[#8c97a4]" />
                <p className="text-[10px] leading-relaxed text-[#858f9b]">
                  {scanner.connectionStatus === 'connected'
                    ? 'Connected, but no tick history has arrived for this market yet.'
                    : 'Live quote and tick time will populate when a market connection is established.'}
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="panel mt-4 overflow-hidden rounded-2xl" aria-labelledby="results-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e9bd4d]/[0.08] text-[#e9bd4d]"><BarChart3 size={16} /></div>
              <div>
                <h3 id="results-heading" className="text-[13px] font-bold text-[#e3e7ec]">Historical analysis</h3>
                <p className="mt-0.5 text-[10px] text-[#818b98]">Observed frequencies from recent tick history</p>
              </div>
            </div>
            <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[9px] font-bold uppercase tracking-[.1em] text-[#9ca5b0]">Informational · not a prediction</span>
          </div>

          {scanner.isAnalyzing ? (
            <div className="p-5" aria-live="polite" data-testid="status-analysis-loading">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-[#c8b06c]"><RefreshCw size={13} className="animate-spin" /> Reading historical ticks</div>
              <div className="scan-bar rounded-full" />
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="skeleton h-[58px] rounded-lg" />)}</div>
            </div>
          ) : scanner.analysis ? (
            <div className="fade-up p-4 sm:p-5" data-testid="content-analysis">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="eyebrow">Calculation</p>
                  <h4 className="mt-1 text-[16px] font-bold tracking-[-.025em] text-[#edf0f3]">{scanner.analysis.title}</h4>
                  <p className="mt-1 text-[11px] text-[#8994a0]">{scanner.analysis.window}</p>
                </div>
                <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2">
                  <span className="eyebrow !text-[9px]">Sample size</span>
                  <span className="mono text-[13px] font-medium text-[#e9bd4d]" data-testid="text-sample-size">{scanner.analysis.sampleSize.toLocaleString()}</span>
                  <span className="text-[10px] text-[#82909d]">ticks</span>
                </div>
              </div>
              {scanner.analysis.metrics.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {scanner.analysis.metrics.map((metric, index) => (
                    <div key={`${metric.label}-${index}`} className="rounded-xl border border-white/[0.07] bg-[#121922]/75 p-3.5" data-testid={`metric-${index}`}>
                      <p className="text-[10px] font-medium text-[#929daa]">{metric.label}</p>
                      <p className="mono mt-2 text-[19px] font-medium tracking-[-.04em] text-[#e5c361]">{metric.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-3 text-[11px] text-[#8994a0]" data-testid="status-empty-metrics">No frequency metrics were returned for this calculation.</p>
              )}
              {scanner.analysis.note && <p className="mt-3 border-l-2 border-[#e9bd4d]/50 pl-3 text-[11px] leading-relaxed text-[#9ba5b0]">{scanner.analysis.note}</p>}
            </div>
          ) : (
            <div className="flex min-h-[164px] flex-col items-center justify-center px-5 py-7 text-center" data-testid="status-empty-analysis">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025] text-[#8994a0]"><ArrowUpRight size={18} /></div>
              <p className="text-[12px] font-bold text-[#d1d6dc]">
                {invalidSelection ? 'Select a valid market first' : scanner.markets.length === 0 ? 'No active market data' : 'No analysis yet'}
              </p>
              <p className="mt-1.5 max-w-[440px] text-[10px] leading-relaxed text-[#818b98]">
                {invalidSelection
                  ? 'The selected market is unavailable. Choose from the active markets before analysing.'
                  : scanner.markets.length === 0
                    ? 'Markets and tick history appear only after the public feed returns active symbols.'
                    : 'Choose a strategy and run an analysis to review historical frequencies. No sample values are shown.'}
              </p>
              {scanner.connectionStatus === 'connected' && scanner.markets.length > 0 && !invalidSelection && (
                <button type="button" onClick={scanner.analyze} disabled={!canAnalyze} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#e9bd4d]/25 bg-[#e9bd4d]/[0.06] px-3 py-2 text-[10px] font-bold text-[#e8c869] transition hover:bg-[#e9bd4d]/[0.11] disabled:opacity-50" data-testid="button-analyze-empty">
                  <ScanLine size={13} /> Analyse history
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-white/[0.065] bg-[#11171f]/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-2">
              <ShieldAlert size={13} className="mt-0.5 shrink-0 text-[#a68c4a]" />
              <p className="max-w-[850px] text-[10px] leading-relaxed text-[#929ba5]">Informational only — historical tick patterns do not guarantee future results. Trading involves risk.</p>
            </div>
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[.09em] text-[#66717e]">Read-only market scanner</span>
          </div>
        </section>

        {scanner.ticks.length > 0 && (
          <section className="panel mt-4 rounded-2xl px-4 py-4 sm:px-5" aria-labelledby="history-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 id="history-heading" className="text-[12px] font-bold text-[#dce1e7]">Recent tick history</h3>
                <p className="mt-0.5 text-[10px] text-[#818b98]">Latest records received from the selected market</p>
              </div>
              <span className="mono text-[10px] text-[#7f8b98]">{scanner.ticks.length} received</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Recent market ticks">
              {scanner.ticks.slice(-8).reverse().map((tick, index) => (
                <div key={`${tick.epoch}-${index}`} className="min-w-[112px] flex-1 rounded-lg border border-white/[0.065] bg-[#111820]/60 px-3 py-2.5">
                  <p className="mono truncate text-[12px] font-medium text-[#dce1e6]">{formatQuote(tick.quote, tick.pipSize)}</p>
                  <p className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-[#7d8895]">
                    <span>{formatTickTime(tick.epoch).split(' ')[0]}</span>
                    <span className="mono text-[#d0b45c]">{tick.lastDigit ?? '—'}</span>
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        <footer className="px-1 pb-2 pt-5 text-center text-[9px] tracking-[.03em] text-[#5f6a77]">
          Public Deriv market data · Historical frequencies are descriptive only
        </footer>
      </main>
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
