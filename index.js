/**
 * @file index.js
 * @description Expo / React Native application entry point.
 *
 * react-native-get-random-values MUST be imported before uuid or any other
 * module that calls crypto.getRandomValues(). This polyfill patches the
 * global so that uuid v4 generation works correctly on Android/iOS.
 *
 * This is the very first JS file that executes in the app process.
 */

// Polyfill crypto.getRandomValues — must come before everything else
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and also ensures that whether you load the app in Expo Go or a native build,
// the environment is set up appropriately.
registerRootComponent(App);
