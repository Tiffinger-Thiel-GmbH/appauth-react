import React, { memo, ReactNode } from 'react';

import { useLoginContext } from './AuthProvider';

interface Props {
  children: ReactNode;
}

const AuthGuard = ({ children }: Props): JSX.Element => {
  const { isLoggedIn } = useLoginContext();

  return isLoggedIn ? <>{children}</> : <></>;
};

export default memo(AuthGuard);
