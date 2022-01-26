import {
  AuthorizationNotifier,
  AuthorizationRequest,
  AuthorizationRequestHandler,
  AuthorizationServiceConfiguration,
  DefaultCrypto,
  FetchRequestor,
  LocalStorageBackend,
  RedirectRequestHandler,
  TokenResponse,
} from '@openid/appauth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { performEndSessionRequest, performRefreshTokenRequest, performTokenRequest } from './api';
import { EndSessionRequestHandler } from '../appauth/endSessionRequestHandler';
import { NoHashQueryStringUtils } from '../appauth/noHashQueryStringUtils';
import { RedirectEndSessionRequestHandler } from '../appauth/redirectEndSessionRequestHandler';

export type Device = 'android' | 'web' | 'ios';

export interface AuthenticateOptions {
  openIdConnectUrl: string;
  clientId: string;
  scope: string;
  redirectUrl: string;
}

export interface AuthState {
  login: () => Promise<void>;
  logout: () => Promise<boolean | undefined>;
  token?: string;
  isLoggedIn: boolean;
  isReady: boolean;
}

export interface AuthOptions {
  options: AuthenticateOptions;
  device?: Device;

  authHandler?: AuthorizationRequestHandler;
  endSessionHandler?: EndSessionRequestHandler;
}

// Hack to prevent double code loading
let codeLoaded: boolean = false;

const AUTH_REFRESH_TOKEN_KEY = 'AUTH_REFRESH_TOKEN';

const storage = new LocalStorageBackend();

export const useAuth = ({
  options,
  authHandler = new RedirectRequestHandler(storage, new NoHashQueryStringUtils(), window.location, new DefaultCrypto()),
  endSessionHandler = new RedirectEndSessionRequestHandler(new LocalStorageBackend(), new NoHashQueryStringUtils(), window.location),
}: AuthOptions): AuthState => {
  // ready defines if the Authentication is initialized.
  // (e.g. the auto login is done)
  const [isReady, setIsReady] = useState(false);
  const [token, setToken] = useState<string>();
  const [idToken, setIdToken] = useState<string>();
  const [configuration, setConfiguration] = useState<AuthorizationServiceConfiguration>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [refreshToken, setRefreshToken] = useState<string>();
  const [refreshInterval, setRefreshInterval] = useState(Math.floor(3240000));

  const isLoggedIn = token !== undefined && isReady;

  /**
   * Set the tokens and refresh interval from the given TokenResponse.
   */
  const setTokenResponse = useCallback((oResponse: TokenResponse) => {
    if (!oResponse.accessToken) {
      return;
    }

    setToken(oResponse.accessToken);

    if (oResponse.refreshToken) {
      setRefreshToken(oResponse.refreshToken);
      void storage.setItem(AUTH_REFRESH_TOKEN_KEY, oResponse.refreshToken);
    }

    setIdToken(oResponse.idToken);
    setIsReady(true);

    // Set the interval to a bit shorter time.
    setRefreshInterval(Math.floor((oResponse.expiresIn || 3600) * 1000 * 0.9));
  }, []);

  // Auto login if refresh token exists.
  useEffect(() => {
    void (async () => {
      const savedRefreshToken = await storage.getItem(AUTH_REFRESH_TOKEN_KEY);
      if (!savedRefreshToken) {
        setIsReady(true);
        return;
      }
      if (configuration) {
        await performRefreshTokenRequest(configuration, options.clientId, options.redirectUrl, savedRefreshToken)
          .then(setTokenResponse)
          .catch(console.error);
      }
    })();
  }, [configuration, options.redirectUrl, options.clientId, setTokenResponse]);

  // Refresh periodically.
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (!isLoggedIn || !refreshToken) {
        return;
      }

      if (configuration) {
        await performRefreshTokenRequest(configuration, options.clientId, options.redirectUrl, refreshToken)
          .then(setTokenResponse)
          .catch(console.error);
      }
    }, refreshInterval);

    return () => {
      clearInterval(timeoutId);
    };
  }, [configuration, options.redirectUrl, isLoggedIn, options.clientId, refreshInterval, refreshToken, setTokenResponse]);

  // Fetch the well known config one time.
  useEffect(() => {
    AuthorizationServiceConfiguration.fetchFromIssuer(options.openIdConnectUrl, new FetchRequestor())
      .then(response => {
        console.log('Fetched service configuration', response);
        setConfiguration(response);
      })
      .catch(error => {
        console.log('Something bad happened', error);
      });
  }, [options.openIdConnectUrl, options.redirectUrl]);

  // Adds a listener for the redirect and triggers the token loading with the code retrieved from that.
  useEffect(() => {
    if (!configuration) {
      return;
    }

    const notifier = new AuthorizationNotifier();
    authHandler.setAuthorizationNotifier(notifier);
    notifier.setAuthorizationListener((request, response, error) => {
      if (error) {
        console.error(error);
        return;
      }

      // As this cb seems to be called too often some times, only run it the first time.
      if (codeLoaded || !configuration) {
        return;
      }
      codeLoaded = true;

      // response object returns code which is in URL i.e. response.code
      // request object returns code_verifier i.e request.internal.code_verifier

      if (response) {
        performTokenRequest(
          configuration,
          options.clientId,
          options.redirectUrl,
          response.code,

          // Needed for PKCE to work
          request && request.internal
            ? {
                code_verifier: request.internal.code_verifier,
              }
            : undefined,
        )
          .then(setTokenResponse)
          .catch(oError => {
            console.error(oError);
          });
      }
    });

    // Run the auth completion (listener in the useEffect above) to handle
    // the redirects.
    void authHandler.completeAuthorizationRequestIfPossible();
  }, [authHandler, configuration, options.redirectUrl, options.clientId, setTokenResponse]);

  const login = useCallback(async () => {
    if (!configuration || !authHandler || !isReady) {
      throw new Error('called login too soon - you can check that with "isReady"');
    }

    // create a request
    const request = new AuthorizationRequest({
      client_id: options.clientId,
      redirect_uri: options.redirectUrl,
      scope: options.scope,
      response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
      state: undefined,
      extras: { prompt: 'consent', access_type: 'offline' },
    });

    // make the authorization request
    authHandler.performAuthorizationRequest(configuration, request);
  }, [authHandler, configuration, options.redirectUrl, isReady, options.clientId, options.scope]);

  const logout = useCallback(async () => {
    const tmpIdToken = idToken;

    codeLoaded = false;
    setRefreshToken(undefined);
    setToken(undefined);
    setIdToken(undefined);

    if (!tmpIdToken || !configuration) {
      return;
    }

    void performEndSessionRequest(endSessionHandler, configuration, options.clientId, options.redirectUrl, idToken);

    return true;
  }, [configuration, endSessionHandler, idToken, options.clientId, options.redirectUrl]);

  return useMemo(
    () => ({
      login,
      logout,
      isLoggedIn,
      isReady: isReady,
      token,
    }),
    [isLoggedIn, isReady, login, logout, token],
  );
};
