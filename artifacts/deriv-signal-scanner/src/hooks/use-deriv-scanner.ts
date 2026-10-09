import { useCallback, useEffect, useRef, useState } from 'react';

const supportedMarkets: Record<string, string> = {
  R_10: 'Volatility 10 Index',
  R_25: 'Volatility 25 Index',
  R_50: 'Volatility 50 Index',
  R_75: 'Volatility 75 Index',
  R_100: 'Volatility 100 Index',
  '1HZ10V': 'Volatility 10 (1s) Index',
  '1HZ15V': 'Volatility 15 (1s) Index',
  '1HZ25V': 'Volatility 25 (1s) Index',
  '1HZ30V': 'Volatility 30 (1s) Index',
  '1HZ50V': 'Volatility 50 (1s) Index',
  '1HZ75V': 'Volatility 75 (1s) Index',
  '1HZ90V': 'Volatility 90 (1s) Index',
  '1HZ100V': 'Volatility 100 (1s) Index',
};

const maxTickCount = 500;
const historyCount = 500;
const reconnectDelay = (attempt: number) =>
  Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);

export type StrategyId =
  | 'matches-differs'
  | 'even-odd'
  | 'over-under'
  | 'rise-fall';

type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'loading-markets'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface Market {
  symbol: string;
  displayName: string;
  pipSize?: number;
}

export interface Tick {
  symbol: string;
  quote: number;
  epoch: number;
  pipSize: number;
  lastDigit: number | null;
}

interface Metric {
  label: string;
  value: string;
}

export interface Analysis {
  title: string;
  window: string;
  sampleSize: number;
  digitSampleSize: number;
  recommendedDigit?: number;
  conditionalMatchesByDigit: Array<{
    digit: number;
    count: number;
    sampleSize: number;
    rate: number;
    estimate: number;
  }>;
  metrics: Metric[];
  outcomes: Array<{
    label: string;
    count: number;
    rate: number;
    direction?: 'over' | 'under';
    barrier?: number;
    acceptedDigits?: number[];
  }>;
  digitFrequencies: Array<{ digit: number; count: number; rate: number }>;
  note: string;
}

interface DerivMessage {
  req_id?: number;
  msg_type?: string;
  error?: { message?: string; code?: string };
  active_symbols?: Array<{
    symbol?: string;
    display_name?: string;
    pip?: number | string;
    underlying_symbol?: string;
    underlying_symbol_name?: string;
    pip_size?: number | string;
  }>;
  history?: {
    prices?: Array<number | string>;
    times?: number[];
  };
  pip_size?: number;
  subscription?: { id?: string };
  tick?: {
    symbol?: string;
    quote?: number | string;
    epoch?: number;
    pip_size?: number;
  };
}

interface PendingAnalysis {
  id: number;
  market: string;
  strategy: StrategyId;
}

const strategyLabels: Record<StrategyId, string> = {
  'matches-differs': 'Matches & Differs',
  'even-odd': 'Even & Odd',
  'over-under': 'Over & Under',
  'rise-fall': 'Rise & Fall',
};

function decimalPlaces(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return undefined;

  const plainValue = numericValue.toFixed(10).replace(/0+$/, '');
  const decimalPoint = plainValue.indexOf('.');
  return decimalPoint === -1 ? 0 : plainValue.length - decimalPoint - 1;
}

function normalizePipSize(value: number | undefined): number | undefined {
  if (!Number.isInteger(value) || value === undefined || value < 0 || value > 10) {
    return undefined;
  }
  return value;
}

function getLastDigit(quote: number, pipSize: number): number {
  const formattedQuote = quote.toFixed(pipSize);
  const lastNumericCharacter = formattedQuote.match(/\d(?=\D*$)/)?.[0];
  return lastNumericCharacter === undefined ? 0 : Number(lastNumericCharacter);
}

function makeTick(
  symbol: string,
  quoteValue: number | string,
  epoch: number,
  pipSize: number | undefined,
): Tick | undefined {
  const quote = Number(quoteValue);
  const precision = normalizePipSize(pipSize);
  if (
    !Number.isFinite(quote)
    || !Number.isFinite(epoch)
    || precision === undefined
  ) {
    return undefined;
  }

  return {
    symbol,
    quote,
    epoch,
    pipSize: precision,
    lastDigit: getLastDigit(quote, precision),
  };
}

function makeTicksFromHistory(
  symbol: string,
  prices: Array<number | string> | undefined,
  times: number[] | undefined,
  pipSize: number | undefined,
): Tick[] {
  if (!prices || !times) return [];

  const count = Math.min(prices.length, times.length);
  const ticks: Tick[] = [];
  for (let index = 0; index < count; index += 1) {
    const tick = makeTick(symbol, prices[index], times[index], pipSize);
    if (tick) ticks.push(tick);
  }
  return ticks.slice(-maxTickCount);
}

function percentage(count: number, total: number): string {
  return total === 0 ? '0.0%' : `${((count / total) * 100).toFixed(1)}%`;
}

function calculateAnalysis(strategy: StrategyId, ticks: Tick[]): Analysis {
  const title = strategyLabels[strategy];
  const note =
    'Prediction estimates are based on recent market data and may not reflect future outcomes.';
  const validTicks = ticks.filter((tick) => tick.lastDigit !== null);
  const digitCounts = Array.from({ length: 10 }, (_, digit) =>
    validTicks.filter((tick) => tick.lastDigit === digit).length,
  );
  const digitFrequencies = digitCounts
    .map((count, digit) => ({
      digit,
      count,
      rate: validTicks.length === 0 ? 0 : (count / validTicks.length) * 100,
    }))
    .sort((first, second) => second.count - first.count || first.digit - second.digit);
  const metrics: Metric[] = [];
  const outcomes: Analysis['outcomes'] = [];
  let recommendedDigit: number | undefined;
  let conditionalMatchesByDigit: Analysis['conditionalMatchesByDigit'] = [];
  let sampleSize = validTicks.length;
  let window = `Last ${sampleSize} ticks`;
  const addOutcome = (label: string, count: number) => {
    outcomes.push({
      label,
      count,
      rate: sampleSize === 0 ? 0 : (count / sampleSize) * 100,
    });
  };

  switch (strategy) {
    case 'matches-differs': {
      const pairs = validTicks.slice(1).map((tick, index) => ({
        previousDigit: validTicks[index].lastDigit,
        matches: tick.lastDigit === validTicks[index].lastDigit,
      }));
      const matches = pairs.filter((pair) => pair.matches).length;
      const targetDigit = validTicks[validTicks.length - 1]?.lastDigit;
      conditionalMatchesByDigit = Array.from({ length: 10 }, (_, digit) => {
        const opportunities = pairs.filter((pair) => pair.previousDigit === digit);
        const count = opportunities.filter((pair) => pair.matches).length;
        const priorWeight = 20;
        const overallMatchRate = pairs.length === 0 ? 0 : matches / pairs.length;
        return {
          digit,
          count,
          sampleSize: opportunities.length,
          rate: opportunities.length === 0 ? 0 : (count / opportunities.length) * 100,
          estimate: ((count + overallMatchRate * priorWeight) / (opportunities.length + priorWeight)) * 100,
        };
      });
      sampleSize = pairs.length;
      window = `Last ${validTicks.length} ticks · ${sampleSize} consecutive comparisons`;
      addOutcome('Matches', matches);
      recommendedDigit = targetDigit ?? undefined;
      metrics.push({ label: 'Matches previous digit', value: `${matches} · ${percentage(matches, sampleSize)}` });
      break;
    }
    case 'even-odd': {
      const even = validTicks.filter((tick) => tick.lastDigit! % 2 === 0).length;
      addOutcome('Even', even);
      addOutcome('Odd', sampleSize - even);
      metrics.push(
        { label: 'Even digits (0, 2, 4, 6, 8)', value: `${even} · ${percentage(even, sampleSize)}` },
        { label: 'Odd digits (1, 3, 5, 7, 9)', value: `${sampleSize - even} · ${percentage(sampleSize - even, sampleSize)}` },
      );
      break;
    }
    case 'over-under': {
      const contracts = [
        { direction: 'over', barrier: 3 },
        { direction: 'over', barrier: 4 },
        { direction: 'over', barrier: 5 },
        { direction: 'under', barrier: 6 },
        { direction: 'under', barrier: 5 },
        { direction: 'under', barrier: 4 },
      ] as const;
      for (const contract of contracts) {
        const acceptedDigits = Array.from({ length: 10 }, (_, digit) => digit)
          .filter((digit) => contract.direction === 'over' ? digit > contract.barrier : digit < contract.barrier);
        const count = validTicks.filter((tick) => acceptedDigits.includes(tick.lastDigit!)).length;
        const label = `${contract.direction === 'over' ? 'Over' : 'Under'} ${contract.barrier}`;
        outcomes.push({
          label,
          count,
          rate: sampleSize === 0 ? 0 : (count / sampleSize) * 100,
          direction: contract.direction,
          barrier: contract.barrier,
          acceptedDigits,
        });
        metrics.push({
          label: `${label} · digits ${acceptedDigits.join(', ')}`,
          value: `${count} · ${percentage(count, sampleSize)}`,
        });
      }
      const recommendedContract = sampleSize > 0
        ? outcomes.reduce((best, outcome) =>
          !best || outcome.rate > best.rate ? outcome : best,
        undefined as Analysis['outcomes'][number] | undefined)
        : undefined;
      if (recommendedContract) {
        recommendedDigit = digitFrequencies.find((frequency) =>
          recommendedContract.acceptedDigits?.includes(frequency.digit),
        )?.digit;
      }
      window = `Last ${sampleSize} ticks · six candidate barriers`;
      break;
    }
    case 'rise-fall': {
      const changes = validTicks.slice(1).map((tick, index) => {
        const previous = validTicks[index].quote;
        return tick.quote > previous ? 'rise' : tick.quote < previous ? 'fall' : 'unchanged';
      });
      const rises = changes.filter((change) => change === 'rise').length;
      const falls = changes.filter((change) => change === 'fall').length;
      sampleSize = changes.length;
      window = `Last ${validTicks.length} ticks · ${sampleSize} consecutive comparisons`;
      addOutcome('Rise', rises);
      addOutcome('Fall', falls);
      addOutcome('Unchanged', sampleSize - rises - falls);
      metrics.push(
        { label: 'Rise', value: `${rises} · ${percentage(rises, sampleSize)}` },
        { label: 'Fall', value: `${falls} · ${percentage(falls, sampleSize)}` },
        { label: 'Unchanged', value: `${sampleSize - rises - falls} · ${percentage(sampleSize - rises - falls, sampleSize)}` },
      );
      break;
    }
  }

  return {
    title,
    window,
    sampleSize,
    digitSampleSize: validTicks.length,
    recommendedDigit,
    conditionalMatchesByDigit,
    metrics,
    outcomes,
    digitFrequencies,
    note,
  };
}

export function useDerivScanner() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState('');
  const [selectedStrategy, setSelectedStrategy] =
    useState<StrategyId>('matches-differs');
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);
  const subscribeRef = useRef<((symbol: string) => void) | null>(null);
  const selectedMarketRef = useRef(selectedMarket);
  const selectedStrategyRef = useRef(selectedStrategy);
  const marketPipSizeRef = useRef(new Map<string, number>());
  const activeSymbolsRequestRef = useRef<number | null>(null);
  const tickRequestRef = useRef<{ id: number; symbol: string } | null>(null);
  const analysisRequestRef = useRef<PendingAnalysis | null>(null);
  const subscriptionIdRef = useRef<string | null>(null);
  const subscribedMarketRef = useRef<string | null>(null);
  const requestIdRef = useRef(1);
  const [connectionVersion, setConnectionVersion] = useState(0);

  selectedMarketRef.current = selectedMarket;
  selectedStrategyRef.current = selectedStrategy;

  const reconnect = useCallback(() => {
    reconnectRef.current?.();
  }, []);

  const analyze = useCallback(() => {
    const socket = socketRef.current;
    const symbol = selectedMarketRef.current;
    if (!symbol || !socket || socket.readyState !== WebSocket.OPEN) return;

    const id = requestIdRef.current;
    requestIdRef.current += 1;
    analysisRequestRef.current = {
      id,
      market: symbol,
      strategy: selectedStrategyRef.current,
    };
    setAnalysis(null);
    setIsAnalyzing(true);
    setError(null);
    socket.send(JSON.stringify({
      ticks_history: symbol,
      count: historyCount,
      end: 'latest',
      style: 'ticks',
      req_id: id,
    }));
  }, []);

  const changeStrategy = useCallback((strategy: StrategyId) => {
    selectedStrategyRef.current = strategy;
    setSelectedStrategy(strategy);
    setAnalysis(null);
  }, []);

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connectionTimeout: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempts = 0;
    let allowReconnect = true;

    const clearTimers = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (connectionTimeout) clearTimeout(connectionTimeout);
    };

    const scheduleReconnect = () => {
      if (!active || !allowReconnect || reconnectTimer) return;
      const delay = reconnectDelay(reconnectAttempts);
      reconnectAttempts += 1;
      setConnectionStatus('reconnecting');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!active) return;
      clearTimers();
      setError(null);
      setConnectionStatus(reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

      const socket = new WebSocket(
        'wss://api.derivws.com/trading/v1/options/ws/public',
      );
      socketRef.current = socket;
      subscriptionIdRef.current = null;
      subscribedMarketRef.current = null;

      connectionTimeout = setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING) {
          setError('The market-data connection timed out. Retrying.');
          socket.close();
        }
      }, 15000);

      socket.addEventListener('open', () => {
        if (!active) {
          socket.close();
          return;
        }
        if (connectionTimeout) clearTimeout(connectionTimeout);
        setConnectionStatus('loading-markets');
        const id = requestIdRef.current;
        requestIdRef.current += 1;
        socket.send(JSON.stringify({
          active_symbols: 'brief',
          req_id: id,
        }));
        activeSymbolsRequestRef.current = id;
      });

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        if (!active) return;

        let message: DerivMessage;
        try {
          message = JSON.parse(event.data) as DerivMessage;
        } catch (parseError) {
          console.error('Could not parse a Deriv market-data message.', parseError);
          setError('The market-data service returned an invalid response.');
          return;
        }

        if (message.error) {
          const description = message.error.message || 'The Deriv API returned an error.';
          const requestId = message.req_id;
          if (analysisRequestRef.current?.id === requestId) {
            analysisRequestRef.current = null;
            setIsAnalyzing(false);
            setError(description);
            return;
          }
          if (tickRequestRef.current?.id === requestId) {
            tickRequestRef.current = null;
            subscribedMarketRef.current = null;
            setError(description);
            return;
          }
          setError(description);
          if (activeSymbolsRequestRef.current === requestId) {
            activeSymbolsRequestRef.current = null;
            allowReconnect = false;
            socket.close();
            setConnectionStatus('error');
          }
          return;
        }

        if (message.active_symbols) {
          activeSymbolsRequestRef.current = null;
          const activeMarkets = message.active_symbols.flatMap((item) => {
            const symbol = item.underlying_symbol ?? item.symbol;
            if (!symbol || !(symbol in supportedMarkets)) return [];
            const pipSize = decimalPlaces(item.pip_size ?? item.pip);
            if (pipSize !== undefined) {
              marketPipSizeRef.current.set(symbol, pipSize);
            }
            return [{
              symbol,
              displayName:
                item.underlying_symbol_name
                ?? item.display_name
                ?? supportedMarkets[symbol],
              pipSize,
            }];
          });

          setMarkets(activeMarkets);
          setConnectionStatus('connected');
          reconnectAttempts = 0;
          setConnectionVersion((version) => version + 1);
          setError(null);
          if (
            selectedMarketRef.current
            && !activeMarkets.some((market) => market.symbol === selectedMarketRef.current)
          ) {
            setSelectedMarket('');
          } else if (!selectedMarketRef.current && activeMarkets.length > 0) {
            setSelectedMarket(activeMarkets[0].symbol);
          }
          return;
        }

        if (message.req_id !== undefined && tickRequestRef.current?.id === message.req_id) {
          const request = tickRequestRef.current;
          tickRequestRef.current = null;
          if (request.symbol !== selectedMarketRef.current) return;

          const pipSize =
            normalizePipSize(message.pip_size)
            ?? marketPipSizeRef.current.get(request.symbol);
          const historyTicks = makeTicksFromHistory(
            request.symbol,
            message.history?.prices,
            message.history?.times,
            pipSize,
          );
          subscriptionIdRef.current = message.subscription?.id ?? null;
          setTicks(historyTicks);
          return;
        }

        if (message.req_id !== undefined && analysisRequestRef.current?.id === message.req_id) {
          const request = analysisRequestRef.current;
          analysisRequestRef.current = null;
          setIsAnalyzing(false);
          if (request.market !== selectedMarketRef.current) return;

          const pipSize =
            normalizePipSize(message.pip_size)
            ?? marketPipSizeRef.current.get(request.market);
          const historyTicks = makeTicksFromHistory(
            request.market,
            message.history?.prices,
            message.history?.times,
            pipSize,
          );
          setAnalysis(calculateAnalysis(request.strategy, historyTicks));
          return;
        }

        if (message.tick) {
          const tickMessage = message.tick;
          const symbol = tickMessage.symbol;
          if (!symbol || symbol !== selectedMarketRef.current) return;
          const tick = makeTick(
            symbol,
            tickMessage.quote ?? Number.NaN,
            tickMessage.epoch ?? Number.NaN,
            normalizePipSize(tickMessage.pip_size)
              ?? marketPipSizeRef.current.get(symbol),
          );
          if (!tick) {
            setError('A live tick was missing a valid quote, timestamp, or precision.');
            return;
          }
          setTicks((currentTicks) => [...currentTicks, tick].slice(-maxTickCount));
        }
      });

      socket.addEventListener('error', () => {
        if (!active) return;
        setError('Could not connect to Deriv market data. Retrying.');
      });

      socket.addEventListener('close', () => {
        if (!active) return;
        if (socketRef.current === socket) socketRef.current = null;
        subscriptionIdRef.current = null;
        subscribedMarketRef.current = null;
        tickRequestRef.current = null;
        analysisRequestRef.current = null;
        setIsAnalyzing(false);
        scheduleReconnect();
      });
    };

    const subscribeToMarket = (symbol: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (!symbol) {
        if (subscriptionIdRef.current) {
          socket.send(JSON.stringify({ forget: subscriptionIdRef.current }));
        }
        subscriptionIdRef.current = null;
        subscribedMarketRef.current = null;
        tickRequestRef.current = null;
        return;
      }
      if (subscribedMarketRef.current === symbol) return;

      if (subscriptionIdRef.current) {
        socket.send(JSON.stringify({ forget: subscriptionIdRef.current }));
      }

      const id = requestIdRef.current;
      requestIdRef.current += 1;
      subscribedMarketRef.current = symbol;
      tickRequestRef.current = { id, symbol };
      subscriptionIdRef.current = null;
      socket.send(JSON.stringify({
        ticks_history: symbol,
        count: historyCount,
        end: 'latest',
        style: 'ticks',
        subscribe: 1,
        req_id: id,
      }));
    };

    subscribeRef.current = subscribeToMarket;
    reconnectRef.current = () => {
      reconnectAttempts = 0;
      allowReconnect = true;
      clearTimers();
      setConnectionStatus('reconnecting');
      const currentSocket = socketRef.current;
      if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {
        currentSocket.close(1000, 'Manual reconnect');
      } else {
        connect();
      }
    };

    connect();

    return () => {
      active = false;
      allowReconnect = false;
      clearTimers();
      reconnectRef.current = null;
      subscribeRef.current = null;
      socketRef.current?.close(1000, 'Component unmounted');
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    setTicks([]);
    setAnalysis(null);
    setIsAnalyzing(false);
    analysisRequestRef.current = null;
    subscribeRef.current?.(selectedMarket);
  }, [selectedMarket, connectionVersion]);

  return {
    connectionStatus,
    markets,
    selectedMarket,
    setSelectedMarket,
    selectedStrategy,
    setSelectedStrategy: changeStrategy,
    ticks,
    analysis,
    isAnalyzing,
    error,
    reconnect,
    analyze,
  };
}
