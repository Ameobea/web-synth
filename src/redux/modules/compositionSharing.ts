import { buildModule } from 'jantix';

const actionGroups = {};

interface CompositionSharingReduxState {}

export default buildModule<CompositionSharingReduxState, typeof actionGroups>({}, actionGroups);
