import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

const wasm = import('./engine');
import App from './App';
import { store } from './redux';
import ViewContextSwitcher from './ViewContextSwitcher';

const SVGS: HTMLElement[] = ['background-svg', 'foreground-svg'].map(
  document.getElementById.bind(document)
) as any[];

let ACTIVE_SHAPE: SVGElement = null!;
let ATTR_COUNTER: number = 0;
const notes: SVGElement[] = [];

export const get_active_attr = (key: string): string | null => ACTIVE_SHAPE.getAttribute(key);

/**
 * Sets an attribute on the active shape to the provided value
 */
export const set_active_attr = (key: string, val: string) => ACTIVE_SHAPE.setAttribute(key, val);

const renderHelper = (
  fn: (...args: any[]) => { name: string; attrs: { [key: string]: string } }
) => (canvasIndex: number, ...args: any[]): number => {
  const svg = SVGS[canvasIndex];
  const { name, attrs } = fn(...args);
  const shape = document.createElementNS('http://www.w3.org/2000/svg', name);
  const id = ATTR_COUNTER;
  Object.entries({ ...attrs, id: `e-${id}` }).forEach(([key, val]) => shape.setAttribute(key, val));
  svg.appendChild(shape);
  ACTIVE_SHAPE = shape;
  ATTR_COUNTER += 1;
  return id;
};

const getElem = (id: number): HTMLElement => document.getElementById(`e-${id}`)!;

export const render_triangle = renderHelper(
  (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    color: string,
    border_color: string
  ) => ({
    attrs: {
      points: `${x1},${y1} ${x2},${y2} ${x3},${y3}`,
      style: `fill:${color};stroke:${border_color};stroke-width:1`,
    },
    name: 'polygon',
  })
);

export const render_quad = renderHelper(
  (x: number, y: number, width: number, height: number, className: string) => ({
    name: 'rect',
    attrs: {
      x: x.toString(),
      y: y.toString(),
      width: width.toString(),
      height: height.toString(),
      class: className,
    },
  })
);

export const render_line = renderHelper(
  (x1: number, y1: number, x2: number, y2: number, className: string) => ({
    name: 'line',
    attrs: {
      x1: x1.toString(),
      y1: y1.toString(),
      x2: x2.toString(),
      y2: y2.toString(),
      class: className,
    },
  })
);

export const delete_element = (id: number): void => {
  const elem = getElem(id);
  elem.parentNode!.removeChild(elem);
};

export const get_attr = (id: number, key: string): string | null => getElem(id)!.getAttribute(key);

export const set_attr = (id: number, key: string, val: string): void =>
  getElem(id).setAttribute(key, val);

export const del_attr = (id: number, key: string): void => getElem(id).removeAttribute(key);

export const add_class = (id: number, className: string): void =>
  getElem(id).classList.add(className);

export const remove_class = (id: number, className: string): void =>
  getElem(id).classList.remove(className);

/**
 * The current `ACTIVE_SHAPE` is pushed into the `notes` array and its index is returned.
 */
export const push_note = (): number => {
  notes.push(ACTIVE_SHAPE);
  return notes.length - 1;
};

export const save_composition = (base64Data: string) =>
  window.localStorage.setItem('composition', base64Data);

export const load_composition = (): string | null => window.localStorage.getItem('composition');

const deleteAllChildren = (node: HTMLElement) => {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
};

export const clear_canvases = () => SVGS.forEach(deleteAllChildren);

let engineHandle: typeof import('./engine');

export const init_midi_editor_ui = () =>
  ReactDOM.render(
    <Provider store={store}>
      <App engine={engineHandle} />
    </Provider>,
    document.getElementById('root')!
  );

const createViewContextSwitcher = (engine: typeof import('./engine')) =>
  ReactDOM.render(
    <ViewContextSwitcher engine={engine} />,
    document.getElementById('view-context-switcher')
  );

export const cleanup_midi_editor_ui = () =>
  ReactDOM.unmountComponentAtNode(document.getElementById('root')!);

wasm.then(engine => {
  engineHandle = engine;
  engine.init();

  window.addEventListener('beforeunload', engine.handle_window_close);

  createViewContextSwitcher(engine);

  const scrollOffset = () => Math.max(document.getElementById('canvases')!.scrollTop - 2, 0);
  const foregroundCanvas = SVGS[1];

  foregroundCanvas.addEventListener('mousedown', evt => {
    evt.preventDefault();
    engine.handle_mouse_down(evt.pageX, evt.pageY + scrollOffset());
  });
  foregroundCanvas.addEventListener('mouseup', evt =>
    engine.handle_mouse_up(evt.pageX, evt.pageY + scrollOffset())
  );
  foregroundCanvas.addEventListener('mousemove', evt =>
    engine.handle_mouse_move(evt.pageX, evt.pageY + scrollOffset())
  );
  foregroundCanvas.addEventListener('wheel', evt => engine.handle_mouse_wheel(evt.deltaX));
  foregroundCanvas.addEventListener('contextmenu', evt => evt.preventDefault());

  document.addEventListener('keydown', evt => {
    if (evt.key === 'Backspace') {
      evt.preventDefault();
    }

    engine.handle_key_down(evt.key, evt.ctrlKey, evt.shiftKey);
  });
  document.addEventListener('keyup', evt =>
    engine.handle_key_up(evt.key, evt.ctrlKey, evt.shiftKey)
  );
});
