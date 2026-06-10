import * as PIXI from 'src/controls/pixi';

export const hexToVec3 = (hex: number): string => {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return `vec3(${r.toFixed(5)}, ${g.toFixed(5)}, ${b.toFixed(5)})`;
};

export const f = (n: number): string => {
  const s = `${n}`;
  return s.includes('.') ? s : `${s}.0`;
};

/**
 * A display object that draws a geometry with a raw shader directly, bypassing PIXI's
 * Graphics/Sprite layers entirely.  Supports instanced geometry via `geometry.instanceCount`.
 */
export default class ShaderMesh extends PIXI.Container {
  protected geometry: PIXI.Geometry;
  protected shader: PIXI.Shader;
  private glState: PIXI.State = PIXI.State.for2d();
  protected indexCount: number;

  constructor(geometry: PIXI.Geometry, shader: PIXI.Shader, indexCount: number) {
    super();
    this.geometry = geometry;
    this.shader = shader;
    this.indexCount = indexCount;
  }

  protected _render(renderer: PIXI.Renderer) {
    if (this.geometry.instanced && this.geometry.instanceCount === 0) {
      return;
    }

    renderer.batch.flush();
    renderer.shader.bind(this.shader);
    renderer.state.set(this.glState);
    renderer.geometry.bind(this.geometry, this.shader);
    renderer.geometry.draw(
      PIXI.DRAW_MODES.TRIANGLES,
      this.indexCount,
      0,
      this.geometry.instanced ? this.geometry.instanceCount : undefined
    );
  }

  public destroy(options?: Parameters<PIXI.Container['destroy']>[0]) {
    super.destroy(options);
    this.geometry.destroy();
    this.shader.destroy();
  }
}
