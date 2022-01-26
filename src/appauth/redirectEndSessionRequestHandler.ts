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

import {
  AuthorizationServiceConfiguration,
  BasicQueryStringUtils,
  LocalStorageBackend,
  LocationLike,
  log,
  StorageBackend,
} from '@openid/appauth';
import { EndSessionRequest } from './endSessionRequest';
import { EndSessionRequestHandler } from './endSessionRequestHandler';

/**
 * Represents an AuthorizationRequestHandler which uses a standard
 * redirect based code flow.
 */
export class RedirectEndSessionRequestHandler extends EndSessionRequestHandler {
  public constructor(
    // use the provided storage backend
    // or initialize local storage with the default storage backend which
    // uses window.localStorage
    public storageBackend: StorageBackend = new LocalStorageBackend(),
    utils: BasicQueryStringUtils = new BasicQueryStringUtils(),
    public locationLike: LocationLike = window.location,
  ) {
    super(utils);
  }

  public performEndSessionRequest(configuration: AuthorizationServiceConfiguration, request: EndSessionRequest): void {
    // before you make request, clear the storage.
    void this.storageBackend.clear().then(() => {
      // make the redirect request
      const url = this.buildRequestUrl(configuration, request);
      log('Making a request to ', request, url);
      this.locationLike.assign(url);
    });
  }
}
