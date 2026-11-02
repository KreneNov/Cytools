import {
  handleWebhookRequest,
  extractPaymentCode,
  parseRequestBody,
  isWebhookAuthorized,
  sendJson,
} from '../_webhook_core.js';
import type { ExtendedRequest, ExtendedResponse } from '../_webhook_core.js';

export {
  extractPaymentCode,
  parseRequestBody,
  isWebhookAuthorized,
  sendJson,
};
export type { ExtendedRequest, ExtendedResponse };

export default handleWebhookRequest;
