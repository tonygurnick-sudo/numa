import { useState, useRef } from 'react';
import { LayoutForm } from '../layouts/layout-form';
//import { Preloader } from '../../components/preloader';

import { Button, Form } from 'react-bootstrap';

const NumaLogin = () => {
  const status_error = 'error';

  const workspaceIDRef = useRef();
  const usernameRef = useRef();
  const passwordRef = useRef();

  const [alertLogin, setAlertLogin] = useState('d-none');
  const [arletLoginContent, setArletLoginContent] = useState('');

  //const [loggedIn, setLoggedIn] = useState(false);

  //  let verify = searchParams.get('verify');

  const post_numa_workspace = '/api/platform/numa/workspace';

  const handleSubmit = (e) => {
    e.preventDefault();

    const workspace_id = workspaceIDRef.current.value;

    const loginData = {
      username: usernameRef.current.value,
      password: passwordRef.current.value,
    };
    window.localStorage.removeItem('numJWT');

    const doFetch = async () => {
      await fetch(`${post_numa_workspace}/${workspace_id}/`, {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify(loginData),
      })
        .then((Response) => Response.json())
        .then((data) => {
          if (data.status === status_error) {
            setAlertLogin('alert alert-secondary');
            setArletLoginContent(data.message);
          } else {
            // TODO
            //
            // Ssave jwt data

            console.log('login worked');
            // setLoggedIn(true);
          }
        })
        .catch(console.error);
    };
    doFetch();
  };

  return (
    <>
      <LayoutForm
        FormName={'numalogin'}
        Content={
          <>
            <h1 className="mb-2">Numa Login</h1>
            <p className="mb-4 fs-lg-1">Welcome back! Please enter your details.</p>
            <br />

            <Form onSubmit={handleSubmit}>
              <label htmlFor="password">Workspace ID</label>
              <input
                id="workspaceID"
                name="workspaceID"
                type="text"
                className="form-control mb-3"
                placeholder="Enter your workspace ID"
                ref={workspaceIDRef}
              />

              <label htmlFor="email">Username</label>
              <input
                id="username"
                type="text"
                name="username"
                className="form-control mb-3"
                placeholder="Enter your username"
                ref={usernameRef}
              />
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" className="form-control mb-3" ref={passwordRef} />

              <div className={alertLogin} role="alert">
                {arletLoginContent}
              </div>

              <Button variant="primary x-5" type="submit">
                Submit Details
              </Button>
            </Form>
          </>
        }
      ></LayoutForm>
    </>
  );
};

export { NumaLogin };
