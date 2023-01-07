import React from 'react';

import { login, register } from 'src/api';
import type { ModalCompProps } from 'src/controls/Modal';
import { setLoginToken } from 'src/persistance';
import { getSentry } from 'src/sentry';
import './LoginModal.css';

type LoginModalProps = ModalCompProps<undefined>;

type LoginState =
  | { type: 'notLoggedIn' }
  | { type: 'loggingIn' }
  | { type: 'loggedIn' }
  | { type: 'loginFailed'; error: string };

export const LoginModal: React.FC<LoginModalProps> = ({ onSubmit, onCancel }) => {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loginState, setLoginState] = React.useState<LoginState>({ type: 'notLoggedIn' });

  const doLogin = async (loginFn: (username: string, password: string) => Promise<string>) => {
    if (loginState.type === 'loggingIn') {
      return;
    }

    if (!username || !password) {
      setLoginState({ type: 'loginFailed', error: 'Username and password are required' });
      return;
    }

    setLoginState({ type: 'loggingIn' });
    try {
      const loginToken = await loginFn(username, password);
      setLoginState({ type: 'loggedIn' });
      await setLoginToken(loginToken);
      onSubmit(undefined);
    } catch (err) {
      setLoginState({ type: 'loginFailed', error: `${err}` });
    }
  };

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLInputElement>) => {
    if (evt.key === 'Enter') {
      doLogin(login);
    }
  };

  return (
    <div className='login-modal'>
      <h2>Login</h2>
      <div className='login-modal-input-container'>
        <label>Username</label>
        <input
          type='text'
          value={username}
          onChange={evt => setUsername(evt.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className='login-modal-input-container'>
        <label>Password</label>
        <input
          type='password'
          value={password}
          onChange={evt => setPassword(evt.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className='login-modal-buttons-container'>
        <button
          onClick={() => {
            getSentry()?.captureMessage('Login button clicked', {
              level: 'info',
              tags: { username },
            });
            doLogin(login);
          }}
        >
          Login
        </button>
        <button
          onClick={() => {
            getSentry()?.captureMessage('Register button clicked', {
              level: 'info',
              tags: { username },
            });
            doLogin(register);
          }}
        >
          Register
        </button>

        <button onClick={onCancel}>Cancel</button>
      </div>

      <div className='login-modal-status'>
        {loginState.type === 'loggingIn' && <p>Logging in...</p>}
        {loginState.type === 'loginFailed' && (
          <p style={{ color: 'red' }}>Login failed: {loginState.error}</p>
        )}
      </div>
    </div>
  );
};
