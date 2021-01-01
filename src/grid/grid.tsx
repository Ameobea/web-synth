import * as R from 'ramda';
import { getEngine } from 'src/util';

// The number of pixels from the top of the page that the main content (canvases, editor, etc.)
// is rendered.
const CONTENT_OFFSET_TOP = 34;
let ACTIVE_SHAPE: SVGElement = null!;
let ATTR_COUNTER = 0;
const notes: SVGElement[] = [];
let SVGS: [SVGSVGElement, SVGSVGElement];

const resetAttrCounter = () => {
  ATTR_COUNTER = 0;
};

const buildGridDOMID = (vcId: string) => `grid-${vcId}`;

export const init_grid = (vcId: string) => {
  const engine = getEngine()!;

  const gridElement = document.createElement('div');
  gridElement.id = buildGridDOMID(vcId);
  gridElement.setAttribute('width', '100vh');
  const canvasesWrapperElement = document.createElement('div');
  gridElement.append(canvasesWrapperElement);
  canvasesWrapperElement.id = 'canvases-wrapper';
  canvasesWrapperElement.setAttribute('height', '720');
  canvasesWrapperElement.setAttribute('width', '100vh');
  const backgroundCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  backgroundCanvas.setAttribute('class', 'notes');
  backgroundCanvas.setAttribute('height', '1400');
  backgroundCanvas.setAttribute('width', '4000');
  backgroundCanvas.id = 'background-svg';
  const foregroundCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  foregroundCanvas.setAttribute('class', 'notes');
  foregroundCanvas.setAttribute('height', '1400');
  foregroundCanvas.setAttribute('width', '4000');
  foregroundCanvas.id = 'foreground-svg';
  canvasesWrapperElement.append(backgroundCanvas);
  canvasesWrapperElement.append(foregroundCanvas);

  const contentElement = document.getElementById('content');
  if (!contentElement) {
    throw new Error('No element with id `content` found in the DOM');
  }
  contentElement.append(gridElement);

  SVGS = [backgroundCanvas, foregroundCanvas];

  const scrollOffset = () => Math.max(gridElement.scrollTop - 2, 0);

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
  foregroundCanvas.addEventListener('wheel', evt => engine.handle_mouse_wheel(evt.deltaX), {
    passive: true,
  });
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

  return gridElement;
};

export const hide_grid = (vcId: string) => {
  document.getElementById(buildGridDOMID(vcId))!.style.display = 'none';
};

export const unhide_grid = (vcId: string) => {
  document.getElementById(buildGridDOMID(vcId))!.style.display = 'block';
};

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

export const cleanup_grid = (vcId: string) => {
  resetAttrCounter();

  const domId = buildGridDOMID(vcId);
  const gridElement = document.getElementById(domId);
  if (!gridElement) {
    console.error(
      `Tried to cleanup grid with vcId ${vcId} but no element with id ${domId} exists in the DOM`
    );
    return;
  }

  gridElement.remove();
};
