/**
 * Chart.js registration + light-theme defaults for the Numa Dashboard.
 *
 * The library has to be auto-registered once per app. We do that here so
 * any tab component can just import a Chart variant and use it.
 */
import {
  Chart,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { ND_COLORS } from './theme';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip
);

Chart.defaults.color = ND_COLORS.textFaint;
Chart.defaults.borderColor = 'rgba(31, 31, 31, 0.08)';
Chart.defaults.font.family = "'Inter', 'Axiforma Book', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export { Chart };
