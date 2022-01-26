/*
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { StringMap } from '@openid/appauth';

/**
 * Represents an AuthorizationRequest as JSON.
 */
export interface EndSessionRequestJson {
  client_id: string;
  redirect_uri: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  id_token_hint: string;
  state?: string;
  extras?: StringMap;
  internal?: StringMap;
}

/**
 * Represents the EndSessionRequest.
 */
export class EndSessionRequest {
  // NOTE:
  // redirect_uri, token_id and state are actually optional.
  // However AppAuth is more opionionated, and requires you to use both.

  public clientId: string;
  public redirectUri: string;
  public idTokenHint: string;
  public state: string;
  public extras?: StringMap;
  public internal?: StringMap;

  /**
   * Constructs a new EndSessionRequest.
   * Use a `undefined` value for the `state` parameter, to generate a random
   * state for CSRF protection.
   */
  public constructor(request: EndSessionRequestJson) {
    this.clientId = request.client_id;
    this.redirectUri = request.redirect_uri;
    this.idTokenHint = request.id_token_hint;
    this.state = request.state || '';
    this.extras = request.extras;
    // read internal properties if available
    this.internal = request.internal;
  }

  /**
   * Serializes the AuthorizationRequest to a JavaScript Object.
   */
  public toJson(): EndSessionRequestJson {
    // Always make sure that the code verifier is setup when toJson() is called.
    return {
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      id_token_hint: this.idTokenHint,
      state: this.state,
      extras: this.extras,
      internal: this.internal,
    };
  }
}
