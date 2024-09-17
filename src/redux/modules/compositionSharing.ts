import { buildModule } from 'jantix';

const actionGroups = {};

type CompositionSharingReduxState = Record<never, never>;

export default buildModule<CompositionSharingReduxState, typeof actionGroups>({}, actionGroups);
