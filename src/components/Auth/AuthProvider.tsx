import React, { FC, ReactNode, useContext } from 'react';
import { AuthOptions, AuthState, useAuth } from '../../hooks/Auth';

export const AuthContext = React.createContext<AuthState | undefined>(undefined);

export const useLoginContext = (): AuthState => {
  const loginState = useContext(AuthContext);
  if (loginState === undefined) {
    throw new Error('login state not injected\nwrap your components with the AuthProvider');
  }

  return loginState;
};

export interface AuthProviderProps extends AuthOptions {
  children: ReactNode;
}

export const AuthProvider: FC<AuthProviderProps> = ({ children, ...options }) => {
  const state = useAuth(options);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
};
