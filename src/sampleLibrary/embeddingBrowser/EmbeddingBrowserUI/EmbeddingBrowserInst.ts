import * as d3 from 'd3';

import 'd3-scale-chromatic';
import type {
  AudioSampleEmbedding,
  AudioSampleEmbeddingDatum,
  AudioSampleEmbeddingSampleClickData,
} from './types';

type ClickHandler = (d: AudioSampleEmbeddingSampleClickData) => void;

interface EmbeddingBrowserInstParams {
  container: HTMLElement;
  width: number;
  height: number;
  embedding: AudioSampleEmbedding;
  clickHandler: ClickHandler;
}

export class EmbeddingBrowserInst {
  private container: HTMLElement;
  private width: number;
  private height: number;
  private embedding: AudioSampleEmbedding;
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private infoBox!: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private clickHandler: ClickHandler;
  private colorScale: d3.ScaleOrdinal<string, string> = d3
    .scaleOrdinal<string>()
    .domain(['vocal', 'kick', 'snare', 'fx', 'perc', 'hat', 'other'])
    .range(d3.schemeTableau10);
  private searchInput!: d3.Selection<HTMLInputElement, unknown, null, undefined>;

  constructor(params: EmbeddingBrowserInstParams) {
    this.container = params.container;
    this.width = params.width;
    this.height = params.height;
    this.embedding = params.embedding;
    this.clickHandler = params.clickHandler;

    this.init();
  }

  private init() {
    this.svg = d3
      .select(this.container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .attr('cursor', 'grab');

    this.infoBox = d3
      .select(this.container)
      .append('div')
      .attr('class', 'info-box')
      .style('position', 'absolute')
      .style('left', '0')
      .style('bottom', '0')
      .style('padding', '10px')
      .style('background-color', 'rgba(0, 0, 0, 0.7)')
      .style('color', '#eee')
      .style('border', '1px solid rgba(200, 200, 200, 0.5)')
      .style('font-family', 'Hack, monospace')
      .style('display', 'none');

    this.searchInput = d3
      .select(this.container)
      .append('input')
      .attr('type', 'text')
      .attr('placeholder', 'Search samples...')
      .style('position', 'absolute')
      .style('top', '0')
      .style('left', '0')
      .style('padding', '5px')
      .style('border', '1px solid #999')
      .style('font-family', 'Hack, monospace')
      .on('input', this.handleSearchInputChange.bind(this));

    const zoom = d3.zoom().on('zoom', event => {
      const transform = event.transform;
      pointsGroup.attr('transform', transform.toString());
    });

    const pointsGroup = this.svg.append('g').attr('class', 'points').attr('cursor', 'grab');

    this.svg.call(zoom);

    pointsGroup
      .selectAll('circle')
      .data(Object.entries(this.embedding.points))
      .enter()
      .append('circle')
      .attr('r', ([_key, _d]) => 4)
      .attr('cursor', 'pointer')
      .attr('fill', ([_key, d]) => this.colorizePoint(d.color))
      .on('mouseover', this.handleMouseOver.bind(this))
      .on('mouseout', this.handleMouseOut.bind(this))
      .on('click', (_evt, [key, d]) => {
        const sampleName = this.embedding.names[+key];
        const info = { ...d, sampleName };
        this.clickHandler(info);
      });

    this.rescalePoints();
  }

  private handleMouseOver(evt: MouseEvent, [key, d]: [string, AudioSampleEmbeddingDatum]) {
    this.infoBox
      .style('display', 'block')
      .html(`<p>Sample Name: ${this.embedding.names[+key]}</p>` + `<p>Color: ${d.color}</p>`);

    // Make hovered point larger
    if (evt.target) {
      d3.select(evt.target as SVGElement).attr('r', 6.4);
    }
  }

  private handleMouseOut(evt: MouseEvent) {
    this.infoBox.style('display', 'none');
    if (evt.target) {
      d3.select(evt.target as SVGElement).attr('r', 4);
    }
  }

  private handleSearchInputChange() {
    const searchString = this.searchInput.property('value').toLowerCase();
    const pointsGroup = this.svg.select('.points');

    pointsGroup.selectAll('circle').style('display', entry => {
      const [key] = entry as [string, AudioSampleEmbedding['points'][string]];
      const sampleName = this.embedding.names[+key].toLowerCase();

      return sampleName.includes(searchString) ? 'initial' : 'none';
    });
  }

  private colorizePoint(category: string): string {
    return this.colorScale(category);
  }

  public destroy() {
    this.svg?.remove();
    this.infoBox?.remove();
  }

  private rescalePoints() {
    const xExtent = d3.extent(Object.values(this.embedding.points), d => d.x);
    const yExtent = d3.extent(Object.values(this.embedding.points), d => d.y);

    if (
      xExtent[0] === undefined ||
      xExtent[1] === undefined ||
      yExtent[0] === undefined ||
      yExtent[1] === undefined
    ) {
      throw new Error('Invalid extent; empty embedding?');
    }

    const pointsAspectRatio = (xExtent[1] - xExtent[0]) / (yExtent[1] - yExtent[0]);
    const containerAspectRatio = this.width / this.height;

    let xRange, yRange;

    if (pointsAspectRatio > containerAspectRatio) {
      xRange = [20, this.width - 20];
      const scaleFactor = this.width / (xExtent[1] - xExtent[0]);
      const scaledHeight = (yExtent[1] - yExtent[0]) * scaleFactor;
      const yOffset = (this.height - scaledHeight) / 2;
      yRange = [yOffset, yOffset + scaledHeight];
    } else {
      yRange = [20, this.height - 20];
      const scaleFactor = this.height / (yExtent[1] - yExtent[0]);
      const scaledWidth = (xExtent[1] - xExtent[0]) * scaleFactor;
      const xOffset = (this.width - scaledWidth) / 2;
      xRange = [xOffset, xOffset + scaledWidth];
    }

    const xScale = d3.scaleLinear().domain(xExtent).range(xRange);
    const yScale = d3.scaleLinear().domain(yExtent).range(yRange);

    this.svg
      .selectAll('circle')
      .attr('cx', ([_key, d]) => xScale(d.x))
      .attr('cy', ([_key, d]) => yScale(d.y));
  }

  public resize(width: number, height: number) {
    this.width = width;
    this.height = height;

    if (this.svg) {
      this.svg.attr('width', this.width).attr('height', this.height);

      this.rescalePoints();
    }
  }
}
