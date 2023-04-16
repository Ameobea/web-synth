import type * as d3t from 'd3';

import d3 from 'src/filterDesigner/d3';
import { SAMPLE_RATE } from 'src/util';

const labelFontSize = 14;
const labelMarginX = 11;
const labelMarginY = -8;
const labelTextYOffset = 16;
const labelWidth = 74;
const labelHeight = 30;
const defaultSide = 'top-left' as 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right';

export class LineSpectrumUIInst {
  private svg: d3t.Selection<SVGSVGElement, unknown, null, any>;
  private xAxis: d3t.Axis<d3t.NumberValue>;
  private yAxis: d3t.Axis<d3t.NumberValue>;
  private xScale: d3t.ScaleLogarithmic<number, number>;
  private yScale: d3t.ScaleLinear<number, number>;
  private crosshair: d3t.Selection<SVGGElement, unknown, null, any>;
  private crosshairXLabel: d3t.Selection<SVGTextElement, unknown, null, any>;
  private crosshairYLabel: d3t.Selection<SVGTextElement, unknown, null, any>;
  private crosshairLabelGroup: d3t.Selection<SVGGElement, unknown, null, any>;

  constructor(
    private container: HTMLElement,
    private size: { width: number; height: number },
    private minDb: number,
    private maxDb: number
  ) {
    this.svg = d3
      .select<HTMLElement, unknown>(this.container)
      .append<SVGSVGElement>('svg')
      .attr('width', this.size.width)
      .attr('height', this.size.height)
      .style('position', 'absolute')
      .style('overflow', 'visible')
      .style('pointer-events', 'none')
      .style('left', '0')
      .style('top', '0')
      .style('z-index', '1');

    this.xScale = d3
      .scaleLog()
      .domain([20, SAMPLE_RATE / 2])
      .range([0, this.size.width]);
    this.yScale = d3.scaleLinear().domain([this.minDb, this.maxDb]).range([this.size.height, 0]);

    this.xAxis = d3.axisBottom(this.xScale).ticks(50);
    this.yAxis = d3.axisLeft(this.yScale);

    this.svg
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${this.size.height})`)
      .call(this.xAxis);

    this.svg.append('g').attr('class', 'y-axis').call(this.yAxis);

    this.crosshair = this.svg
      .append<SVGGElement>('g')
      .attr('class', 'crosshair')
      .style('display', 'none');

    this.crosshair
      .append('line')
      .attr('class', 'x')
      .style('stroke', 'white')
      .style('stroke-width', 1)
      .style('opacity', 0.5)
      .attr('y1', 0)
      .attr('y2', this.size.height);

    this.crosshair
      .append('line')
      .attr('class', 'y')
      .style('stroke', 'white')
      .style('stroke-width', 1)
      .style('opacity', 0.5)
      .attr('x1', 0)
      .attr('x2', this.size.width);

    this.crosshairLabelGroup = this.crosshair.append('g').attr('class', 'label-group');
    this.crosshairXLabel = this.crosshairLabelGroup
      .append('text')
      .attr('class', 'x-label')
      .style('font-size', `${labelFontSize}px`)
      .style('fill', 'white');
    this.crosshairYLabel = this.crosshairLabelGroup
      .append('text')
      .attr('class', 'y-label')
      .style('font-size', `${labelFontSize}px`)
      .style('fill', 'white');
  }

  public updateSize(newSize: { width: number; height: number }) {
    this.size = newSize;
    this.svg.attr('width', this.size.width).attr('height', this.size.height);
    this.xScale.range([0, this.size.width]);
    this.yScale.range([this.size.height, 0]);
    this.updateAxes();
  }

  public updateYRange(newMinY: number, newMaxY: number): void {
    this.minDb = newMinY;
    this.maxDb = newMaxY;
    this.yScale.domain([this.minDb, this.maxDb]);
    this.updateAxes();
  }

  private updateAxes() {
    this.svg
      .select<SVGGElement>('g.x-axis')
      .attr('transform', `translate(0,${this.size.height})`)
      .call(this.xAxis);

    this.svg.select<SVGGElement>('g.y-axis').call(this.yAxis);
  }

  public onMouseMove(xPx: number, yPx: number) {
    // Update crosshair lines
    this.crosshair
      .style('display', null)
      .select<SVGLineElement>('.x')
      .attr('x1', xPx)
      .attr('x2', xPx)
      .attr('y1', 0)
      .attr('y2', this.size.height);

    this.crosshair
      .select<SVGLineElement>('.y')
      .attr('x1', 0)
      .attr('x2', this.size.width)
      .attr('y1', yPx)
      .attr('y2', yPx);

    const xValue = this.xScale.invert(xPx);
    const yValue = this.yScale.invert(yPx);

    let labelX = xPx + labelMarginX;
    let labelY = yPx - labelMarginY;

    if (defaultSide === 'top-left' || defaultSide === 'top-right') {
      labelY = yPx - labelMarginY - labelHeight;
    }
    if (defaultSide === 'bottom-right' || defaultSide === 'top-right') {
      labelX = xPx - labelMarginX - labelWidth;
    }

    // Adjust label position if it goes off the screen
    if (xPx + labelWidth + labelMarginX > this.size.width) {
      labelX = xPx - labelMarginX - labelWidth + 8;
    } else if (xPx - labelWidth - labelMarginX < 0) {
      labelX = xPx + labelMarginX;
    }

    if (yPx + labelHeight + labelTextYOffset > this.size.height) {
      labelY = yPx - labelMarginY - labelHeight;
    } else if (yPx - labelHeight - labelTextYOffset < 0) {
      labelY = yPx - labelMarginY + 8;
    }

    // Update label group position
    this.crosshair
      .select<SVGGElement>('g.label-group')
      .attr('transform', `translate(${labelX},${labelY})`);

    // Update label text
    this.crosshairXLabel.text(`${xValue.toFixed(1)} Hz`);
    this.crosshairYLabel.attr('y', labelTextYOffset).text(`${yValue.toFixed(1)} dB`);
  }

  public onMouseOut() {
    this.crosshair.style('display', 'none');
  }

  public destroy() {
    this.svg.remove();
  }
}
