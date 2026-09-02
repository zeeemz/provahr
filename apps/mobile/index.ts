import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent ensures the environment is set up (Native vs web) and
// that the app renders inside the Expo root component — the SDK 51 equivalent
// of ReactDOM.render / expo/AppEntry.js, but type-checkable in our own tree.
registerRootComponent(App);
