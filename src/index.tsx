import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { connect, Provider } from 'react-redux';

const wasm = import('./engine');
import { store } from 'src/reducers';
import App from './App';

const SVGS: HTMLElement[] = ['background-svg', 'foreground-svg'].map(
  document.getElementById.bind(document)
) as any[];

export const render_triangle = (
  canvas_index: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  color: string,
  border_color: string
) => {
  const SVG = SVGS[canvas_index];
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
  poly.setAttribute('style', `fill:${color};stroke:${border_color};stroke-width:1`);
  SVG.appendChild(poly);
};

export const render_quad = (
  canvas_index: number,
  x: number,
  y: number,
  width: number,
  height: number,
  className: string
) => {
  const SVG = SVGS[canvas_index];
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x.toString());
  rect.setAttribute('y', y.toString());
  rect.setAttribute('width', width.toString());
  rect.setAttribute('height', height.toString());
  rect.setAttribute('class', className);
  SVG.appendChild(rect);
};

export const render_line = (
  canvas_index: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string
) => {
  const SVG = SVGS[canvas_index];
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1.toString());
  line.setAttribute('y1', y1.toString());
  line.setAttribute('x2', x2.toString());
  line.setAttribute('y2', y2.toString());
  line.setAttribute('class', className);
  SVG.appendChild(line);
};

const deleteAllChildren = (node: HTMLElement) => {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
};

wasm.then(engine => {
  engine.init();

  engine.draw_note(engine.Note.Cs, 2, 12.0, 16.0);
});

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);
