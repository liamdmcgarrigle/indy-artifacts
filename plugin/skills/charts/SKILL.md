---
name: charts
description: Use when you are about to put a chart or several numbers on an Indy page, or are choosing how to show data there. Covers which chart fits the data and the reader's question, when a table or KPI counters beat any chart, and how to make a chart read well on a phone. The chart syntax itself is in the publish skill's reference.md.
---

# Choosing charts for Indy pages

This skill covers judgment: which chart, and how to make it read. The syntax is in `../publish/reference.md` (the "```chart", ":::kpis", and "Tables with figures" sections), and every example here uses only keys from there. A key the chart does not read comes back in the publish result as a warning naming the key it most likely meant. A key that does not apply to a type (`sort` on a waterfall, `marks` on a sankey) is refused and the block fails, so read the result after every publish.

## Start from the sentence

Before picking a type, write the one sentence the reader should take away. It becomes the title, and it usually names the shape: "checkout-api is the only service over its error budget" is a ranking against a target; "half of signups stall at email verification" is a conversion through steps; "GPU runners drove most of the cost increase" is a bridge.

| The reader's question | Use | Change course when |
|:--|:--|:--|
| What is the number now? | `:::kpis` counter, with `trend="..."` | Never a one-bar chart or a two-slice pie |
| Which is biggest, who ranks first? | `bar`, `horizontal: true`, `sort: desc` | A table if readers look up their own row or need exact values |
| How do categories compare? | `bar`, vertical for up to 6 short labels | `horizontal: true` for labels over ~12 characters or more than 6 bars |
| How do 2 or 3 measures compare per category? | `bar` with two or three `y` keys (grouped) | 4+ series: split the chart, or use a heatmap |
| How did it change over time? | `line` for about 10+ points, `bar` for fewer periods | `curve: step` for values that jump (price, replica count, plan tier) |
| Are we over or under a target, budget, or SLO? | The chart for the shape, plus a `marks` value line | Bars around a zero line when the values are deviations |
| How is one total split? | Sorted `bar`; `pie` or `doughnut` for 2 to 4 clearly different parts | A counter when there are only two parts ("72% passed") |
| How do shares compare across several totals? | `bar` with `stacked: percent`, usually horizontal | `stacked: true` when the totals matter too |
| How did parts and total move over time? | Stacked `bar` under ~10 periods, stacked `area` for more | A `line` per part if the question is which part grew |
| What explains the change from A to B? | `waterfall` | Sorted `bar` of contributions if start and end do not matter |
| What is the gap or span per category? | `bar` with `range: true` | Grouped bars if the values matter more than the gap |
| How are the values spread? | `histogram` | `box` to compare 3 or more groups |
| Are two measures related? | `scatter` | `bubble` when a third measure matters and rough size is enough |
| An amount and a rate on one timeline? | `bar`, the rate as `series: { as: line, axis: right }` | Two charts for a general audience; never for one unit |
| How many make it through each step? | `funnel` | `sankey` when people leave to different places or paths branch |
| Where did things go? | `sankey` | `funnel` or `bar` when it is one straight chain |
| One measure across two categories? | `heatmap` | A table when exact values drive the decision |
| One thing profiled across several measures? | Grouped horizontal `bar` | `radar` for 1 to 3 profiles on 5 to 8 measures with one scale |

Conditions that decide it:

- Negatives: bars and lines draw them against a zero line. Pie, doughnut, stacks, and funnels cannot. Signed parts of one change belong in a waterfall.
- Parts of a whole: pie, doughnut, `stacked: percent`, and stacked area need parts that don't overlap and add up to the whole. Multi-select survey answers fail this.
- Counts: vertical bars up to about 6 on a phone, horizontal bars to 20 or 30 rows, grouped bars 2 or 3 series, stacks 2 to 5 segments, lines 4 or 5 before you mute all but one.
- Time: under ~10 periods reads well as columns; more reads better as a line.

## When a table or counters beat a chart

One to five headline numbers go in `:::kpis` counters. Add a delta with its period, and a `trend` sparkline (oldest first, 8 to 30 points) when the direction matters:

```md
:::kpis
- p99 latency: 312 ms {tone=good trend="410,398,380,355,340,312"} (-98 ms vs last week)
- Error rate: 0.18% {tone=warn trend="0.09,0.11,0.12,0.15,0.18"}
- Deploys this week: 23 (+5)
:::
```

Pick the tone by whether the move is good, not by its sign: falling latency is `good`.

Use a table (markdown with right-aligned figure columns, or a sortable ```table) when readers look up one row ("where is my service?"), when exact values drive a decision (prices, quotas, rates to two decimals), when each row carries several units, or when the order matters more than the gaps. Use a chart when the message is in the shape: a trend, a gap, an outlier, or a pattern. One or two numbers never get a chart. When a chart needs exact values too, add `labels: true` (12 bars or fewer) or a short table under it.

## Use the expressive types when the data has their shape

Sankeys, waterfalls, heatmaps, and box plots show structure that a bar chart flattens, and the operator wants to see them wherever they fit. The test is the data's structure. Does it split and merge (sankey), add signed steps to a total (waterfall), sit on a grid of two categories (heatmap), or have many raw values per group (box)? Then use that type over a plain bar. If you have to reshape the data to make it fit, go back to a bar or a line.

## Per type

`bar`. Fits amounts across categories and short time series. Avoid for 50+ time points. Rule: the value axis starts at zero, so never set `axes.left.min` above zero on bars, and sort by value unless the categories have a natural order (time, stage, size band).

Grouped and stacked bars. Grouped fits 2 or 3 series compared inside each category. `stacked: true` fits when the total and one part both matter. Only the first segment and the total share a baseline, so list the part the title is about first in `y`. `stacked: percent` hides the totals: give n in the title or a sentence above the chart.

`line` and `area`. Fits change over many points and one series overtaking another. Rule: the default `curve: smooth` can bulge past the real values between sparse points, so use `curve: straight` below ~20 points or near zero, and `step` for discrete changes. Stacked areas need ~10+ dates and 3 to 5 layers. A missing value draws as a gap, so leave the key out when nothing was measured; a 0 claims a measurement.

`pie` and `doughnut`. Fits one total in 2 to 4 parts, best when a share near 25, 50, or 75% is the story. Avoid for close values and for comparing totals (several pies side by side never compare). Indy folds rows beyond six into "Other", so group the tail yourself and give it a real name. A doughnut prints its total in the middle; `center` is the short caption under that number ("used", "tickets"), so don't repeat the total in it.

`scatter` and `bubble`. Fits a relationship between two numeric measures, with outliers named through `label`. Avoid a `trend: linear` line when no pattern is visible, and call the result a correlation. Keep `group` to 3 or fewer. Bubbles size by area and read imprecisely, so use one where rough size is enough:

```chart
type: bubble
title: Teams that deploy more often fail less often
x: deploys
y: cfr
size: engineers
label: team
unit: "%"
axes: { x: { title: Deploys per week }, left: { title: Change failure rate } }
data:
  - { team: Payments, deploys: 22, cfr: 4.1, engineers: 9 }
  - { team: Search, deploys: 31, cfr: 3.2, engineers: 6 }
  - { team: Mobile, deploys: 5, cfr: 11.5, engineers: 12 }
  - { team: Infra, deploys: 14, cfr: 6.0, engineers: 4 }
```

Bars and a line on two axes. Fits an amount and a rate on one x: signups and trial conversion, spend and margin. Avoid for two series in the same unit. Rule: title both axes and start the rate at zero when the bars do. A general audience reads two stacked charts more safely.

```chart
type: bar
title: Signups grew while trial conversion held near 12%
x: month
y: [signups, conversion]
series:
  conversion: { as: line, axis: right, curve: straight }
axes:
  left: { title: Signups }
  right: { title: Trial to paid, unit: "%", min: 0 }
data:
  - { month: May, signups: 1840, conversion: 12.4 }
  - { month: Jun, signups: 2210, conversion: 11.9 }
  - { month: Jul, signups: 2650, conversion: 12.1 }
  - { month: Aug, signups: 3020, conversion: 11.6 }
```

Range bars. Fits spans: p50 to p99 latency, low and high estimates, maintenance windows. Avoid for before and after unless the title says which end is which, since a bar shows no direction.

```chart
type: bar
range: true
horizontal: true
title: eu-west's p99 is three times its p50
x: region
y: [p50, p99]
unit: ms
data:
  - { region: us-east, p50: 120, p99: 310 }
  - { region: us-west, p50: 135, p99: 340 }
  - { region: eu-west, p50: 150, p99: 460 }
```

`histogram`. Fits the shape of one measure: skew, a slow tail, two humps. Avoid below about 30 values (list them or use a box). Rule: try two `bins` settings and keep the one that shows the shape without noise. The sample below is shortened.

```chart
type: histogram
title: Most CI builds finish in 6 to 9 minutes, with a tail past 15
x: minutes
bins: 8
axes: { x: { title: Build time (min) }, left: { title: Builds } }
data: [6.2, 7.1, 6.8, 8.4, 7.7, 6.5, 9.0, 7.3, 15.8, 6.9, 7.5, 8.1, 18.2, 7.0, 6.6, 8.8]
```

`waterfall`. Fits a bridge from one total to another through signed steps: a cost change, headcount, MRR. Avoid past about 12 bars; group small items. Rule: use `labels: true`, because floating bars share no baseline. Increases draw green and decreases red, and the signed labels carry the same meaning for color-blind readers.

```chart
type: waterfall
title: Cloud spend rose $1,750 in September, mostly GPU runners
x: step
y: cost
format: currency
labels: true
data:
  - { step: August, cost: 18400, total: true }
  - { step: GPU runners, cost: 2900 }
  - { step: Egress, cost: 650 }
  - { step: Reserved instances, cost: -1800 }
  - { step: September, total: true }
```

`funnel`. Fits 4 to 6 ordered stages where each stage is a subset of the one before. Avoid for categories without an order (use a bar). Rule: put the overall conversion or the worst step in the title.

```chart
type: funnel
title: Email verification loses more than half of signups
x: stage
y: users
format: number
data:
  - { stage: Visited pricing, users: 12000 }
  - { stage: Started signup, users: 3100 }
  - { stage: Verified email, users: 1400 }
  - { stage: First deploy, users: 620 }
```

`sankey`. Fits flows that split and merge: traffic to outcomes, budget to uses, requests through services, tickets to resolutions. Avoid for one straight chain, and remember a loop is refused. Rule: 2 or 3 stages on a phone, about 5 to 15 nodes, a named "Other" for the tail, and inputs equal to outputs, with losses as their own node ("Left", "Dropped").

```chart
type: sankey
title: 30 of 40 bug reports were fixed; support sent most duplicates
data:
  - { from: Support, to: Fixed, value: 14 }
  - { from: Support, to: Duplicate, value: 6 }
  - { from: QA, to: Fixed, value: 11 }
  - { from: QA, to: "Won't fix", value: 3 }
  - { from: Monitoring, to: Fixed, value: 5 }
  - { from: Monitoring, to: Still open, value: 1 }
```

`heatmap`. Fits one measure across two categories: hour by weekday, service by day, cohort by week. Avoid when fine differences matter (color is the least precise channel) or past about 8 columns on a phone. Rule: order rows and columns by time or total, add `labels: true` when cells have room, and shade by rate when rows differ in size.

```chart
type: heatmap
title: Pages cluster on Monday mornings
x: hour
y: day
value: pages
labels: true
data:
  - { day: Mon, hour: "08:00", pages: 9 }
  - { day: Mon, hour: "12:00", pages: 4 }
  - { day: Mon, hour: "18:00", pages: 1 }
  - { day: Tue, hour: "08:00", pages: 3 }
  - { day: Tue, hour: "12:00", pages: 2 }
  - { day: Tue, hour: "18:00", pages: 1 }
```

`box`. Fits spread across 3 to 20 groups: latency by endpoint, test time by suite. Avoid when the shape matters, since a box hides two humps and sample size (use a histogram). Rule: give n in a sentence above it. Pass raw values (one row per value) or the five numbers:

```chart
type: box
horizontal: true
title: /search has the widest latency spread
x: endpoint
unit: ms
data:
  - { endpoint: /login, min: 40, q1: 62, median: 75, q3: 90, max: 140 }
  - { endpoint: /search, min: 55, q1: 110, median: 180, q3: 290, max: 720 }
  - { endpoint: /checkout, min: 70, q1: 95, median: 120, q3: 150, max: 260 }
```

`radar`. Fits 1 to 3 profiles across 5 to 8 measures on one scale (ratings from 1 to 5, scores out of 100). Avoid with mixed units or more than 3 profiles; use grouped horizontal bars. Rule: the shape changes with spoke order, so put related measures next to each other.

## Rules for every chart

- The title states the finding as a sentence ("p99 fell 25% after the cache change"). A topic ("p99 by week") is a label. Put what was measured, the period, and n in a sentence above the chart when they do not fit the title.
- Units everywhere, through `unit`, `format`, or `currency` on the chart and on each axis in `axes`. `format: percent` reads fractions (0.25 shows as 25%) and is refused for data already in percent; for 45.2 meaning 45.2%, write `unit: "%"`. Use `compact` for large counts and `decimals` to round to what the reader needs.
- One accent: color the series the title talks about and mute the others with `series: { key: { color: muted } }`. Keep one entity the same color across the page.
- Sort by value (`sort: desc`) unless the order means something (time, stages, bands).
- Targets, budgets, SLOs, releases, and incidents go in `marks`, labeled on the chart, in place of a paragraph describing where the line would be. One or two per chart. A forecast or target drawn as data takes `dash: true` under `series`.
- Bars, areas, histograms, and stacks start at zero. Lines and scatters may zoom in; say so when they do.
- A second axis is for a second unit only.
- Phones are ~360px wide. Prefer horizontal bars, keep columns to about 6, keep the legend at `top` or `bottom` (`none` for one series), and raise `height` on long horizontal bar lists (about 28px a row). Two stacked charts read better than one crowded one. Tooltips are awkward on touch, so the key number belongs in the title, a label, or a table.

A pattern that fits many status reports, a line with a target and an incident window:

```chart
type: line
title: p99 stayed under the 400 ms SLO except during Wednesday's incident
x: day
y: p99
unit: ms
curve: straight
marks:
  - { y: 400, label: SLO 400 ms, tone: bad }
  - { from: Wed, to: Thu, label: Incident, tone: warn }
data:
  - { day: Mon, p99: 310 }
  - { day: Tue, p99: 325 }
  - { day: Wed, p99: 640 }
  - { day: Thu, p99: 410 }
  - { day: Fri, p99: 300 }
```

## Honesty checks before you publish

1. The title's claim is true of the data. Check every ratio, percentage, and "every", "straight", or "double" against the rows: one dip breaks "grew every week", and 31 against 17 is not "more than double".
2. Bars, areas, histograms, stacks, and waterfalls start at zero.
3. Parts in a pie, doughnut, `stacked: percent`, or stacked area are non-negative and add up to a real whole.
4. A second axis carries a different unit, and both axes have titles.
5. Smooth curves only on dense data; `step` for values that jump.
6. Radar spokes share one scale from zero.
7. Sankey inputs equal outputs, or the loss has its own node.
8. Heatmaps shade by rate when row sizes differ.
9. A trend line only where the pattern is visible, described as a correlation.
10. Anyone who needs an exact value can find it in a label, the title, or a table.
