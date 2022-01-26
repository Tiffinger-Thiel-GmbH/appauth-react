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

import { AuthorizationServiceConfiguration, QueryStringUtils, StringMap } from '@openid/appauth';
import { EndSessionRequest } from './endSessionRequest';

// TODO(rahulrav@): add more built in parameters.
/* built in parameters. */
export const BUILT_IN_PARAMETERS = ['redirect_uri', 'client_id', 'id_token_hint', 'state'];

/**
 * Defines the interface which is capable of handling an authorization request
 * using various methods (iframe / popup / different process etc.).
 */
export abstract class EndSessionRequestHandler {
  public constructor(public utils: QueryStringUtils) {}

  /**
   * A utility method to be able to build the authorization request URL.
   */
  protected buildRequestUrl(configuration: AuthorizationServiceConfiguration, request: EndSessionRequest): string {
    // build the query string
    // coerce to any type for convenience
    const requestMap: StringMap = {
      redirect_uri: request.redirectUri,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      id_token_hint: request.idTokenHint,
      state: request.state,
      action: 'logout',
    };

    // copy over extras
    if (request.extras) {
      for (const extra in request.extras) {
        if (request.extras.hasOwnProperty(extra)) {
          // check before inserting to requestMap
          if (BUILT_IN_PARAMETERS.indexOf(extra) < 0) {
            requestMap[extra] = request.extras[extra];
          }
        }
      }
    }

    const query = this.utils.stringify(requestMap);
    const baseUrl = configuration.endSessionEndpoint;
    const url = `${baseUrl}?${query}`;
    return url;
  }

  /**
   * Makes an end session request.
   */
  public abstract performEndSessionRequest(configuration: AuthorizationServiceConfiguration, request: EndSessionRequest): void;
}
