import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap'
import { Link, useLocation } from 'react-router-dom'
import {
  BoxSeam,
  PersonCircle,
  BoxArrowRight,
  FileEarmarkText,
  PersonGear,
  House
} from 'react-bootstrap-icons'
import { useAuth } from '@/contexts/AuthContext'
import NumaLogo from '@/assets/numa-logo.svg?react'

export default function NavigationBar() {
  const location = useLocation()
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  return (
    <Navbar bg="white" variant="light" expand="lg" className="border-bottom shadow-sm">
      <Container fluid>
        <Navbar.Brand as={Link} to="/" className="d-flex align-items-center">
          <NumaLogo className="me-2" style={{ width: '32px', height: '32px' }} />
          <span className="fw-semibold">Numa Customer Portal</span>
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="basic-navbar-nav" />

        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <Nav.Link
              as={Link}
              to="/"
              active={location.pathname === '/'}
              className="d-flex align-items-center"
            >
              <House className="me-1" />
              Home
            </Nav.Link>

            <Nav.Link
              as={Link}
              to="/configs"
              active={location.pathname.startsWith('/configs')}
              className="d-flex align-items-center"
            >
              <FileEarmarkText className="me-1" />
              Configs
            </Nav.Link>

            <Nav.Link
              as={Link}
              to="/containers"
              active={location.pathname.startsWith('/containers')}
              className="d-flex align-items-center"
            >
              <BoxSeam className="me-1" />
              Container Images
            </Nav.Link>
          </Nav>

          <Nav className="ms-auto d-flex align-items-center">
            <Nav.Link
              as={Link}
              to="/users"
              className="d-flex align-items-center px-3"
              title="User Management"
            >
              <PersonGear size={20} className="text-muted" />
            </Nav.Link>

            <NavDropdown
              title={
                <span className="d-flex align-items-center px-2 py-1">
                  <PersonCircle size={20} className="text-muted" />
                  <span className="fw-medium ms-2">{user?.username || 'User'}</span>
                </span>
              }
              id="user-dropdown"
              align="end"
              className="user-dropdown"
            >
              <NavDropdown.ItemText className="px-3 py-2">
                <div>
                  <div className="fw-semibold">{user?.username}</div>
                  <div className="small text-muted">{user?.email}</div>
                </div>
              </NavDropdown.ItemText>
              <NavDropdown.Divider />
              <NavDropdown.Item onClick={handleSignOut} className="d-flex align-items-center">
                <BoxArrowRight size={16} className="me-2" />
                Sign Out
              </NavDropdown.Item>
            </NavDropdown>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  )
}
