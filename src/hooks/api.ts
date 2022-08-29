import {
  AuthorizationServiceConfiguration,
  BaseTokenRequestHandler,
  GRANT_TYPE_AUTHORIZATION_CODE,
  GRANT_TYPE_REFRESH_TOKEN,
  StringMap,
  TokenRequest,
  TokenResponse,
} from '@openid/appauth';
import { EndSessionRequest } from '../appauth/endSessionRequest';
import { EndSessionRequestHandler } from '../appauth/endSessionRequestHandler';
import { ConfigurableFetchRequestor, timeoutInterceptor } from '../appauth/fetchRequestor';

export async function performTokenRequest(
  configuration: AuthorizationServiceConfiguration,
  clientId: string,
  redirectUrl: string,
  code: string,
  extras?: StringMap,
  options?: {
    requestTimeoutMilliseconds?: number;
  },
): Promise<TokenResponse> {
  // A. First, you need to create a token request object
  const tokenRequest = new TokenRequest({
    client_id: clientId,
    redirect_uri: redirectUrl,
    grant_type: GRANT_TYPE_AUTHORIZATION_CODE,
    code: code,
    extras,
  });

  // B. Hit `/token` endpoint and get token
  const tokenHandler = new BaseTokenRequestHandler(new ConfigurableFetchRequestor(timeoutInterceptor(options?.requestTimeoutMilliseconds)));
  return tokenHandler.performTokenRequest(configuration, tokenRequest);
}

export async function performRefreshTokenRequest(
  configuration: AuthorizationServiceConfiguration,
  clientId: string,
  redirectUrl: string,
  refreshToken: string | undefined,
  extras?: StringMap,
  options?: {
    requestTimeoutMilliseconds?: number;
  },
): Promise<TokenResponse> {
  const tokenRequest = new TokenRequest({
    client_id: clientId,
    redirect_uri: redirectUrl,
    grant_type: GRANT_TYPE_REFRESH_TOKEN,
    code: undefined,
    refresh_token: refreshToken,
    extras,
  });

  const tokenHandler = new BaseTokenRequestHandler(new ConfigurableFetchRequestor(timeoutInterceptor(options?.requestTimeoutMilliseconds)));
  return tokenHandler.performTokenRequest(configuration, tokenRequest);
}

export function performEndSessionRequest(
  endSessionHandler: EndSessionRequestHandler,
  configuration: AuthorizationServiceConfiguration,
  clientId: string,
  redirectUrl: string,
  idToken: string,
  extras?: StringMap,
): void {
  endSessionHandler.performEndSessionRequest(
    configuration,
    new EndSessionRequest({
      client_id: clientId,
      redirect_uri: redirectUrl,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      id_token_hint: idToken,
      extras,
    }),
  );
}
