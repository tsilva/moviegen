import {createRequire} from 'node:module';
import {registerLegacyRuleRegressions} from './dependency-matcher-regressions.mjs';
registerLegacyRuleRegressions(createRequire(import.meta.url));
import {registerReactRuleRegressions} from './dependency-react-regressions.mjs';
registerReactRuleRegressions(createRequire(import.meta.url));
