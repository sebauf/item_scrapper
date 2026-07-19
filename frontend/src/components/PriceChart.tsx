'use client';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPrice } from '@/lib/format';

export interface PricePoint {
  day: string;
  price: number | null;
  crossedOut: number | null;
}

function formatDay(day: string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | string | null;
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;

  const price = payload.find((p) => p.dataKey === 'price');
  const crossed = payload.find((p) => p.dataKey === 'crossedOut');

  return (
    <div className="bg-surface border border-border rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-foreground mb-1">
        {label ? new Date(label).toLocaleDateString('fr-FR') : ''}
      </p>
      {typeof price?.value === 'number' && (
        <p className="flex items-center gap-1.5 text-muted">
          <span className="w-2.5 h-2.5 rounded-full bg-chart-price inline-block" />
          Prix : <span className="font-semibold text-foreground">{formatPrice(price.value, currency)}</span>
        </p>
      )}
      {typeof crossed?.value === 'number' && (
        <p className="flex items-center gap-1.5 text-muted mt-0.5">
          <span className="w-2.5 h-2.5 rounded-full bg-chart-crossed inline-block" />
          Prix barré : <span className="font-semibold text-foreground">{formatPrice(crossed.value, currency)}</span>
        </p>
      )}
    </div>
  );
}

export function PriceChart({
  data,
  predictedPrice,
  currency,
}: {
  data: PricePoint[];
  predictedPrice?: number;
  currency: string;
}) {
  const hasCrossed = data.some((d) => d.crossedOut !== null);
  const showDots = data.filter((d) => d.price !== null).length <= 20;

  return (
    <div>
      {hasCrossed && (
        <div className="flex items-center gap-4 mb-2 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full bg-chart-price inline-block" />
            Prix
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t-2 border-dashed border-chart-crossed inline-block" />
            Prix barré
          </span>
        </div>
      )}

      <div className="h-64 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => formatPrice(v, currency)}
            />
            <Tooltip
              content={<ChartTooltip currency={currency} />}
              cursor={{ stroke: 'var(--color-ghost)', strokeDasharray: '4 4' }}
            />
            {predictedPrice !== undefined && (
              <ReferenceLine
                y={predictedPrice}
                stroke="var(--color-deal)"
                strokeDasharray="6 4"
                label={{
                  value: 'Prix attendu',
                  position: 'insideTopRight',
                  fill: 'var(--color-deal)',
                  fontSize: 11,
                }}
              />
            )}
            {hasCrossed && (
              <Line
                type="stepAfter"
                dataKey="crossedOut"
                stroke="var(--color-chart-crossed)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4, fill: 'var(--color-chart-crossed)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {/* stepAfter: a price holds until it changes — a spline would invent intermediate prices */}
            <Line
              type="stepAfter"
              dataKey="price"
              stroke="var(--color-chart-price)"
              strokeWidth={2}
              dot={showDots ? { r: 3, fill: 'var(--color-chart-price)', strokeWidth: 0 } : false}
              activeDot={{ r: 4, fill: 'var(--color-chart-price)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
