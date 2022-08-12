import { AppAuthError, Requestor } from '@openid/appauth';

type RequestInterceptor = (url: URL, request: RequestInit) => [URL, RequestInit];

const passthrough: RequestInterceptor = (u, r) => [u, r];

export const timeoutInterceptor: (timeoutMilliseconds?: number) => RequestInterceptor =
  (timeoutMilliseconds = 30000) =>
  (url, request) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMilliseconds);
    request.signal = controller.signal;

    return [url, request];
  };

/**
 * Uses fetch API to make Ajax requests
 */
export class ConfigurableFetchRequestor extends Requestor {
  public constructor(private readonly interceptRequest: RequestInterceptor = passthrough) {
    super();
  }

  public xhr<T>(settings: JQueryAjaxSettings): Promise<T> {
    if (!settings.url) {
      return Promise.reject(new AppAuthError('A URL must be provided.'));
    }
    const url: URL = new URL(settings.url as string);
    const requestInit: RequestInit = {};
    requestInit.method = settings.method;
    requestInit.mode = 'cors';

    if (settings.data) {
      if (settings.method && settings.method.toUpperCase() === 'POST') {
        requestInit.body = settings.data as string;
      } else {
        const searchParams = new URLSearchParams(settings.data);
        searchParams.forEach((value, key) => {
          url.searchParams.append(key, value);
        });
      }
    }

    // Set the request headers
    requestInit.headers = {};
    if (settings.headers) {
      for (const i in settings.headers) {
        if (settings.headers.hasOwnProperty(i)) {
          requestInit.headers[i] = settings.headers[i] as string;
        }
      }
    }

    const isJsonDataType = settings.dataType && settings.dataType.toLowerCase() === 'json';

    // Set 'Accept' header value for json requests (Taken from
    // https://github.com/jquery/jquery/blob/e0d941156900a6bff7c098c8ea7290528e468cf8/src/ajax.js#L644
    // )
    if (isJsonDataType) {
      requestInit.headers.Accept = 'application/json, text/javascript, */*; q=0.01';
    }

    const [modifiedUrl, modifiedRequestInit] = this.interceptRequest(url, requestInit);

    return fetch(modifiedUrl.toString(), modifiedRequestInit).then(response => {
      if (response.status >= 200 && response.status < 300) {
        const contentType = response.headers.get('content-type');
        if (isJsonDataType || (contentType && contentType.indexOf('application/json') !== -1)) {
          return response.json();
        } else {
          return response.text();
        }
      } else {
        return Promise.reject(new AppAuthError(response.status.toString(), response.statusText));
      }
    });
  }
}
