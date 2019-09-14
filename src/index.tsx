import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import * as R from 'ramda';
import Tone from 'tone';

const wasm = import('./engine');
import App from './App';
import { store } from './redux';
import { actionCreators as viewContextManagerActionCreators } from './redux/reducers/viewContextManager';
import { ViewContextManager, ViewContextSwitcher } from './ViewContextManager';

(window as any).Tone = Tone;

const SVGS: HTMLElement[] = ['background-svg', 'foreground-svg'].map(
  document.getElementById.bind(document)
) as any[];

// The number of pixels from the top of the page that the main content (canvases, editor, etc.)
// is rendered.
const CONTENT_OFFSET_TOP = 40;
let ACTIVE_SHAPE: SVGElement = null!;
let ATTR_COUNTER = 0;
const notes: SVGElement[] = [];

export const get_active_attr = (key: string): string | null => ACTIVE_SHAPE.getAttribute(key);

/**
 * Sets an attribute on the active shape to the provided value
 */
export const set_active_attr = (key: string, val: string) => ACTIVE_SHAPE.setAttribute(key, val);

const renderHelper = (
  fn: (...args: any[]) => { name: string; attrs: { [key: string]: string }; idOverride?: number }
) => (canvasIndex: number, ...args: any[]): number => {
  const { name, attrs, idOverride } = fn(...args);

  const shape = document.createElementNS('http://www.w3.org/2000/svg', name);
  const id = idOverride || ATTR_COUNTER;

  Object.entries({ ...attrs, id: `e-${id}` }).forEach(([key, val]) => shape.setAttribute(key, val));

  const svg = SVGS[canvasIndex];
  svg.appendChild(shape);
  ACTIVE_SHAPE = shape;

  if (R.isNil(idOverride)) {
    ATTR_COUNTER += 1;
  }

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
  (
    x: number,
    y: number,
    width: number,
    height: number,
    className: string,
    idOverride?: number
  ) => ({
    name: 'rect',
    attrs: {
      x: x.toString(),
      y: y.toString(),
      width: width.toString(),
      height: height.toString(),
      class: className,
    },
    idOverride,
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

const deleteAllChildren = (node: HTMLElement) => {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
};

export const clear_canvases = () => SVGS.forEach(deleteAllChildren);

let engineHandle: typeof import('./engine');

export const init_midi_editor_ui = () => {
  ReactDOM.render(
    <Provider store={store}>
      <App engine={engineHandle} />
    </Provider>,
    document.getElementById('root')!
  );
};

const createViewContextManager = (engine: typeof import('./engine')) => {
  ReactDOM.render(
    <Provider store={store}>
      <ViewContextManager engine={engine} />
    </Provider>,
    document.getElementById('view-context-manager')
  );

  ReactDOM.render(
    <Provider store={store}>
      <ViewContextSwitcher engine={engine} />
    </Provider>,
    document.getElementById('view-context-switcher')
  );
};

export const cleanup_midi_editor_ui = () => {
  ReactDOM.unmountComponentAtNode(document.getElementById('root')!);
  ATTR_COUNTER = 0;
};

export const update_active_view_contexts = (
  activeViewContextIx: number,
  activeVcsJson: string
): void => {
  const activeViewContexts: {
    minimal_def: { name: string; uuid: string; title?: string };
  }[] = JSON.parse(activeVcsJson);

  store.dispatch(
    viewContextManagerActionCreators.setState({
      activeViewContextIx,
      activeViewContexts: activeViewContexts.map(({ minimal_def, ...rest }) => ({
        ...minimal_def,
        ...rest,
      })),
    })
  );
};

wasm.then(engine => {
  engineHandle = engine;
  engine.init();

  window.addEventListener('beforeunload', engine.handle_window_close);

  createViewContextManager(engine);

  const canvasesElement = document.getElementById('canvases')!;
  const scrollOffset = () => Math.max(canvasesElement.scrollTop - 2, 0);
  const foregroundCanvas = SVGS[1];

  let mouseDown = false;
  foregroundCanvas.addEventListener('mousedown', evt => {
    mouseDown = true;
    engine.handle_mouse_down(evt.pageX, evt.pageY - CONTENT_OFFSET_TOP + scrollOffset());
  });
  foregroundCanvas.addEventListener('mouseup', evt => {
    if (!mouseDown) {
      return;
    }
    mouseDown = false;

    engine.handle_mouse_up(evt.pageX, evt.pageY - CONTENT_OFFSET_TOP + scrollOffset());
  });
  foregroundCanvas.addEventListener('mousemove', evt =>
    engine.handle_mouse_move(evt.pageX, evt.pageY - CONTENT_OFFSET_TOP + scrollOffset())
  );
  foregroundCanvas.addEventListener('wheel', evt => engine.handle_mouse_wheel(evt.deltaX));
  foregroundCanvas.addEventListener('contextmenu', evt => evt.preventDefault());

  document.body.addEventListener('mouseleave', evt => {
    if (mouseDown) {
      engine.handle_mouse_up(evt.pageX, evt.pageY - CONTENT_OFFSET_TOP + scrollOffset());
    }
  });

  document.addEventListener('keydown', evt => {
    engine.handle_key_down(evt.key, evt.ctrlKey, evt.shiftKey);
    // Prevent spacebar from scrolling down the page
    if (
      ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace'].includes(
        evt.code
      ) &&
      !(evt.target instanceof HTMLInputElement || evt.target instanceof HTMLTextAreaElement)
    ) {
      evt.preventDefault();
    }
  });
  document.addEventListener('keyup', evt =>
    engine.handle_key_up(evt.key, evt.ctrlKey, evt.shiftKey)
  );
});
