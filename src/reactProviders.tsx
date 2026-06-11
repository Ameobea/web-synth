import React from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Provider } from 'react-redux';
import type { AnyAction, Store } from 'redux';

const ReactQueryClient = new QueryClient();

export const getReactQueryClient = (): QueryClient => ReactQueryClient;

export function withReactQueryClient<T>(Comp: React.ComponentType<T>): React.ComponentType<T> {
  const client = new QueryClient();
  const WithReactQueryClient: React.FC<T> = ({ ...props }) => (
    <QueryClientProvider client={client}>
      <Comp {...(props as any)} />
    </QueryClientProvider>
  );
  return WithReactQueryClient;
}

export function withReduxProvider<T>(
  store: Store<any, AnyAction>,
  Comp: React.ComponentType<T>
): React.ComponentType<T> {
  const WithReduxProvider: React.FC<T> = ({ ...props }) => (
    <Provider store={store}>
      <Comp {...(props as any)} />
    </Provider>
  );
  return WithReduxProvider;
}
