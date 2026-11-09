import {sendWebhook} from './webhook.js';
// Import and register additional provider functions here.
export const notificationProviders = Object.freeze({
 webhook:sendWebhook,
});
