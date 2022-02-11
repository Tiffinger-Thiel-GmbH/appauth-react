import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppAuthError,
  AuthorizationNotifier,
  AuthorizationRequest,
  AuthorizationRequestHandler,
  AuthorizationServiceConfiguration,
  DefaultCrypto,
  FetchRequestor,
  LocalStorageBackend,
  RedirectRequestHandler,
  StringMap,
  TokenResponse,
} from '@openid/appauth';
import { performEndSessionRequest, performRefreshTokenRequest, performTokenRequest } from './api';
import { EndSessionRequestHandler } from '../appauth/endSessionRequestHandler';
import { NoHashQueryStringUtils } from '../appauth/noHashQueryStringUtils';
import { RedirectEndSessionRequestHandler } from '../appauth/redirectEndSessionRequestHandler';

export interface AuthenticateOptions {
  openIdConnectUrl: string;
  clientId: string;
  scope: string;
  redirectUrl: string;
  usePkce?: boolean;
  tokenRequest?: {
    extras?: StringMap | undefined;
  };
  endSessionRequest?: {
    extras?: StringMap | undefined;
  };
  authorizationRequest?: {
    extras?: StringMap | undefined;
  };
}

export interface AuthState {
  login: () => Promise<void>;
  logout: () => Promise<boolean | undefined>;
  token?: string;
  idToken?: string;
  isLoggedIn: boolean;
  isReady: boolean;
}

export interface AuthOptions {
  options: AuthenticateOptions;

  authHandler?: AuthorizationRequestHandler;
  endSessionHandler?: EndSessionRequestHandler;
}

const AUTH_REFRESH_TOKEN_KEY = 'AUTH_REFRESH_TOKEN';

const storage = new LocalStorageBackend();

const DEFAULT_AUTH_HANDLER = new RedirectRequestHandler(storage, new NoHashQueryStringUtils(), window.location, new DefaultCrypto());
const DEFAULT_END_SESSION_HANDLER = new RedirectEndSessionRequestHandler(storage, new NoHashQueryStringUtils(), window.location);

export const useAuth = ({
  options,
  authHandler = DEFAULT_AUTH_HANDLER,
  endSessionHandler = DEFAULT_END_SESSION_HANDLER,
}: AuthOptions): AuthState => {
  // ready defines if the Authentication is initialized.
  // (e.g. the auto login is done)
  const [isAutoLoginDone, setIsAutoLoginDone] = useState(false);
  const [isInitializationComplete, setIsInitializationComplete] = useState(false);
  const [token, setToken] = useState<string>();
  const [idToken, setIdToken] = useState<string>();
  const [configuration, setConfiguration] = useState<AuthorizationServiceConfiguration>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [refreshToken, setRefreshToken] = useState<string>();
  const [refreshInterval, setRefreshInterval] = useState(Math.floor(3240000));

  const isLoggedIn = token !== undefined && isAutoLoginDone;

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
    setIsAutoLoginDone(true);

    // Set the interval to a bit shorter time.
    setRefreshInterval(Math.floor((oResponse.expiresIn || 3600) * 1000 * 0.9));
  }, []);

  // Auto login if refresh token exists.
  useEffect(() => {
    void (async () => {
      const savedRefreshToken = await storage.getItem(AUTH_REFRESH_TOKEN_KEY);
      if (!savedRefreshToken) {
        setIsAutoLoginDone(true);
        return;
      }
      if (configuration) {
        try {
          const response = await performRefreshTokenRequest(
            configuration,
            options.clientId,
            options.redirectUrl,
            savedRefreshToken,
            options.tokenRequest?.extras,
          );
          setTokenResponse(response);
        } catch (err) {
          if (err instanceof AppAuthError) {
            const statusCode = Number.parseInt(err.message, 10);
            if (statusCode >= 400 && statusCode < 500) {
              // HTTP client error -> token is probably expired
              console.log('Removing expired refresh token');
              await storage.removeItem(AUTH_REFRESH_TOKEN_KEY);
              setIsAutoLoginDone(true);
              return;
            }
          }
          console.error('Refresh token request failed', err);
          setIsAutoLoginDone(true);
        }
      }
    })();
  }, [configuration, options.clientId, options.redirectUrl, options.tokenRequest?.extras, setTokenResponse]);

  // Refresh periodically.
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (!isLoggedIn || !refreshToken) {
        return;
      }

      if (configuration) {
        await performRefreshTokenRequest(configuration, options.clientId, options.redirectUrl, refreshToken, options.tokenRequest?.extras)
          .then(setTokenResponse)
          .catch(console.error);
      }
    }, refreshInterval);

    return () => {
      clearInterval(timeoutId);
    };
  }, [
    configuration,
    options.redirectUrl,
    isLoggedIn,
    options.clientId,
    refreshInterval,
    refreshToken,
    setTokenResponse,
    options.tokenRequest?.extras,
  ]);

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
    let listenerPromise: Promise<void> | undefined;
    notifier.setAuthorizationListener((request, response, error) => {
      listenerPromise = new Promise((resolve, reject) => {
        if (error) {
          reject(error);
          return;
        }

        // As this cb seems to be called too often some times, only run it the first time.
        if (!configuration) {
          resolve();
          return;
        }

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
                  ...(options.tokenRequest?.extras || {}),
                }
              : options.tokenRequest?.extras,
          )
            .then(setTokenResponse)
            .then(resolve)
            .catch(reject);
        }
      });
    });

    // Run the auth completion (listener in the useEffect above) to handle
    // the redirects.
    void authHandler
      .completeAuthorizationRequestIfPossible()
      .then(() => listenerPromise)
      .then(() => setIsInitializationComplete(true))
      .catch(err => console.error(err));
  }, [authHandler, configuration, options.clientId, options.redirectUrl, options.tokenRequest?.extras, setTokenResponse]);

  const login = useCallback(
    async (authorizationRequest?: AuthenticateOptions['authorizationRequest']) => {
      if (!configuration || !authHandler || !isAutoLoginDone || !isInitializationComplete) {
        throw new Error('called login too soon - you can check that with "isReady"');
      }

      const extras = { ...options.authorizationRequest?.extras, ...authorizationRequest?.extras };

      // create a request
      const request = new AuthorizationRequest(
        {
          client_id: options.clientId,
          redirect_uri: options.redirectUrl,
          scope: options.scope,
          response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
          state: undefined,
          extras,
        },
        undefined,
        options.usePkce,
      );

      // make the authorization request
      authHandler.performAuthorizationRequest(configuration, request);
    },
    [
      authHandler,
      configuration,
      isAutoLoginDone,
      isInitializationComplete,
      options.authorizationRequest?.extras,
      options.clientId,
      options.redirectUrl,
      options.scope,
      options.usePkce,
    ],
  );

  const logout = useCallback(
    async (endSessionRequest?: AuthenticateOptions['endSessionRequest']) => {
      const tmpIdToken = idToken;

      setRefreshToken(undefined);
      setToken(undefined);
      setIdToken(undefined);

      if (!tmpIdToken || !configuration) {
        return;
      }

      const extras = { ...options.endSessionRequest?.extras, ...endSessionRequest?.extras };

      void performEndSessionRequest(endSessionHandler, configuration, options.clientId, options.redirectUrl, idToken, extras);

      return true;
    },
    [configuration, endSessionHandler, idToken, options.clientId, options.endSessionRequest?.extras, options.redirectUrl],
  );

  return useMemo(
    () => ({
      login,
      logout,
      isLoggedIn,
      isReady: isAutoLoginDone && isInitializationComplete,
      token,
      idToken,
    }),
    [idToken, isLoggedIn, isAutoLoginDone, isInitializationComplete, login, logout, token],
  );
};
