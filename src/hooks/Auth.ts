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
import { singleEntry } from './mutex';

export enum ErrorAction {
  UNKNOWN,
  AUTO_LOGIN,
  REFRESH_TOKEN_REQUEST,
  FETCH_WELL_KNOWN,
  COMPLETE_AUTHORIZATION_REQUEST,
  HANDLE_AUTHORIZATION_RESPONSE,
}
export interface AuthenticateOptions {
  openIdConnectUrl: string;
  clientId: string;
  scope: string;
  redirectUrl: string;
  usePkce?: boolean;
  /**
   * Set to true if you want to handle token refresh manually (call checkToken)
   */
  disableTokenRefresh?: boolean;
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
  login: (authorizationRequest?: AuthenticateOptions['authorizationRequest']) => Promise<void>;
  logout: () => Promise<boolean | undefined>;
  /**
   * Check if the access token is still valid (by expiresIn value) and perform a token refresh
   * request if the token is expired, or is going to expire soon
   * @param forceRefresh set to true to ignore expiresIn value and always perform a refresh
   * @returns the new set of tokens if the token was refreshed
   */
  checkToken: (forceRefresh?: boolean) => Promise<{ token: string; idToken?: string } | undefined>;
  token?: string;
  idToken?: string;
  isLoggedIn: boolean;
  isReady: boolean;
}

export type ErrorHandler = (err: AppAuthError | Error | unknown, duringAction: ErrorAction) => void;

export interface AuthOptions {
  options: AuthenticateOptions;

  onError?: (err: AppAuthError | Error | unknown, duringAction: ErrorAction) => void;

  authHandler?: AuthorizationRequestHandler;
  endSessionHandler?: EndSessionRequestHandler;
}

interface RefreshTokenState {
  token: string;
  /**
   * issue date of access and refresh token
   */
  issuedAt: Date;
  /**
   * milliseconds from issuedAt when the access token is going to expire
   */
  expiresIn: number;
}

const AUTH_REFRESH_TOKEN_KEY = 'AUTH_REFRESH_TOKEN';

const storage = new LocalStorageBackend();

const DEFAULT_ERROR_HANDLER: ErrorHandler = () => undefined;
const DEFAULT_AUTH_HANDLER = new RedirectRequestHandler(storage, new NoHashQueryStringUtils(), window.location, new DefaultCrypto());
const DEFAULT_END_SESSION_HANDLER = new RedirectEndSessionRequestHandler(storage, new NoHashQueryStringUtils(), window.location);

export const useAuth = ({
  options,
  onError = DEFAULT_ERROR_HANDLER,
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
  const [refreshToken, setRefreshToken] = useState<RefreshTokenState>();

  const isLoggedIn = token !== undefined && isAutoLoginDone;

  /**
   * Set the tokens and refresh interval from the given TokenResponse.
   */
  const setTokenResponse = useCallback((oResponse: TokenResponse) => {
    if (!oResponse.accessToken) {
      return;
    }

    if (oResponse.refreshToken) {
      setRefreshToken({ token: oResponse.refreshToken, issuedAt: new Date(), expiresIn: (oResponse.expiresIn || 3600) * 1000 });
      void storage.setItem(AUTH_REFRESH_TOKEN_KEY, oResponse.refreshToken);
    }

    setToken(oResponse.accessToken);
    setIdToken(oResponse.idToken);
  }, []);

  const _refreshAccessToken = useCallback(
    async (savedRefreshToken: string) => {
      if (!configuration) {
        throw new Error('called refresh too soon - you can check that with "isReady"');
      }
      try {
        const response = await performRefreshTokenRequest(
          configuration,
          options.clientId,
          options.redirectUrl,
          savedRefreshToken,
          options.tokenRequest?.extras,
        );
        setTokenResponse(response);
        return { token: response.accessToken, idToken: response.idToken };
      } catch (err) {
        if (err instanceof AppAuthError) {
          const statusCode = Number.parseInt(err.message, 10);
          if (statusCode >= 400 && statusCode < 500) {
            // HTTP client error -> token is probably expired
            setRefreshToken(undefined);
            setToken(undefined);
            setIdToken(undefined);
            await storage.removeItem(AUTH_REFRESH_TOKEN_KEY);
          }
        }
        onError(err, ErrorAction.REFRESH_TOKEN_REQUEST);
      }
    },
    [configuration, options.clientId, options.redirectUrl, options.tokenRequest?.extras, setTokenResponse, onError],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const performTokenRefresh = useCallback(singleEntry(_refreshAccessToken), [_refreshAccessToken]);

  // Auto login if refresh token exists.
  useEffect(() => {
    void (async () => {
      const savedRefreshToken = await storage.getItem(AUTH_REFRESH_TOKEN_KEY);
      if (!savedRefreshToken || isAutoLoginDone) {
        setIsAutoLoginDone(true);
        return;
      }
      if (configuration) {
        try {
          await performTokenRefresh(savedRefreshToken);
        } finally {
          setIsAutoLoginDone(true);
        }
      }
    })();
  }, [configuration, isAutoLoginDone, onError, performTokenRefresh, setTokenResponse]);

  // Refresh periodically.
  useEffect(() => {
    if (!isLoggedIn || !refreshToken || options.disableTokenRefresh) {
      return;
    }
    const timeoutId = setTimeout(async () => {
      if (configuration && refreshToken) {
        await performTokenRefresh(refreshToken.token);
      }
    }, refreshToken.expiresIn * 0.9);

    return () => {
      clearInterval(timeoutId);
    };
  }, [configuration, isLoggedIn, refreshToken, options.disableTokenRefresh, performTokenRefresh]);

  const checkToken = useCallback(
    async (forceRefresh?: boolean) => {
      if (!refreshToken) {
        return;
      }

      const isExpired = refreshToken.issuedAt.getTime() + refreshToken.expiresIn < Date.now();
      const willExpire = refreshToken.issuedAt.getTime() + refreshToken.expiresIn * 0.9 < Date.now();
      if (!willExpire && !forceRefresh) {
        return;
      }

      if (isExpired) {
        // the token is already expired, refresh synchronously
        return await performTokenRefresh(refreshToken.token);
      } else {
        // the token is still valid, refresh in background
        void performTokenRefresh(refreshToken.token);
      }
    },
    [refreshToken, performTokenRefresh],
  );

  // Fetch the well known config one time.
  useEffect(() => {
    AuthorizationServiceConfiguration.fetchFromIssuer(options.openIdConnectUrl, new FetchRequestor())
      .then(response => {
        setConfiguration(response);
      })
      .catch(err => onError(err, ErrorAction.FETCH_WELL_KNOWN));
  }, [onError, options.openIdConnectUrl, options.redirectUrl]);

  // Adds a listener for the redirect and triggers the token loading with the code retrieved from that.
  useEffect(() => {
    if (!configuration) {
      return;
    }

    const notifier = new AuthorizationNotifier();
    authHandler.setAuthorizationNotifier(notifier);
    // this promise is required to wait for the token request before setting initializationComplete
    // it should never reject, as errors are not handled in all cases
    let listenerPromise: Promise<void> | undefined;
    notifier.setAuthorizationListener((request, response, err) => {
      listenerPromise = new Promise(resolve => {
        if (err) {
          onError(err, ErrorAction.HANDLE_AUTHORIZATION_RESPONSE);
          resolve();
          return;
        }

        // As this cb seems to be called too often some times, only run it the first time.
        // TODO: maybe fixed now. Need to check to be sure...
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
            .catch(err => {
              onError(err, ErrorAction.HANDLE_AUTHORIZATION_RESPONSE);
              resolve();
            });
        }
      });
    });

    // Run the auth completion (listener in the useEffect above) to handle
    // the redirects.
    void authHandler
      .completeAuthorizationRequestIfPossible()
      .then(() => listenerPromise)
      .finally(() => setIsInitializationComplete(true))
      .catch(err => onError(err, ErrorAction.COMPLETE_AUTHORIZATION_REQUEST));
  }, [authHandler, configuration, onError, options.clientId, options.redirectUrl, options.tokenRequest?.extras, setTokenResponse]);

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
      checkToken,
      isLoggedIn,
      isReady: isAutoLoginDone && isInitializationComplete,
      token,
      idToken,
    }),
    [idToken, isLoggedIn, isAutoLoginDone, isInitializationComplete, login, logout, checkToken, token],
  );
};
