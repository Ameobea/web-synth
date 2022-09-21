// Application plugins
import { Application } from '@pixi/app';
// Renderer plugins
import { Renderer } from '@pixi/core';
import { BatchRenderer } from '@pixi/core';
import { InteractionManager } from '@pixi/interaction';
import '@pixi/mixin-cache-as-bitmap';
import { TickerPlugin } from '@pixi/ticker';
import * as utils from '@pixi/utils';

export * from '@pixi/constants';
export * from '@pixi/math';
export * from '@pixi/runner';
export * from '@pixi/settings';
export * from '@pixi/ticker';

export { utils };
export * from '@pixi/display';
export * from '@pixi/core';
export * from '@pixi/sprite';
export * from '@pixi/app';
export * from '@pixi/graphics';

export * from '@pixi/text';
export * from '@pixi/interaction';

Renderer.registerPlugin('batch', BatchRenderer);

Renderer.registerPlugin('interaction', InteractionManager);

Application.registerPlugin(TickerPlugin);
