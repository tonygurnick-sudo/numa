import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

function Breadcrumbs({ label, clearStack }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [breadcrumbs, setBreadcrumbs] = useState([]);

  useEffect(() => {
    // Retrieve the navigation stack from sessionStorage
    const stack = JSON.parse(sessionStorage.getItem('navigation_stack')) || [];

    // Check if the current page is already in the navigation stack
    const currentPageIndex = stack.findIndex((entry) => entry.path === location.pathname);
    if (currentPageIndex !== -1) {
      // Remove all entries after the current page in the stack
      stack.splice(currentPageIndex + 1);
      sessionStorage.setItem('navigation_stack', JSON.stringify(stack));
    } else {
      // Add the current page to the navigation stack
      stack.push({
        path: location.pathname,
        label: label || 'Apps',
      });
      sessionStorage.setItem('navigation_stack', JSON.stringify(stack));
    }

    // Generate breadcrumbs dynamically based on the navigation stack
    const updatedBreadcrumbs = [];

    // Add Home breadcrumb

    if (clearStack || location.pathname === '/dash') {
      // Only show Home breadcrumb as a link when clearing stack
      sessionStorage.removeItem('navigation_stack');
      updatedBreadcrumbs[0] = {
        label: 'Apps',
        path: '/dash',
      };
      if (location.pathname !== '/dash') {
        updatedBreadcrumbs.push({
          label: label,
          path: location.pathname,
        });
      }
      sessionStorage.setItem('navigation_stack', JSON.stringify(updatedBreadcrumbs));
    } else {
      stack.forEach((entry) => {
        const path = entry.path;
        const label = entry.label || 'Apps'; // Provide fallback for empty labels
        updatedBreadcrumbs.push({
          label: label,
          path: path,
        });
      });
    }

    setBreadcrumbs(updatedBreadcrumbs);
  }, [label, location.pathname]);

  const handleBreadcrumbClick = (e, path) => {
    e.preventDefault();
    // Find the index of the clicked breadcrumb
    let clickedIndex = breadcrumbs.findIndex((breadcrumb) => breadcrumb.path === path);
    // Check if the clicked index is greater than or equal to the length of the stack
    const stack = JSON.parse(sessionStorage.getItem('navigation_stack')) || [];
    if (clickedIndex >= stack.length) {
      clickedIndex--;
      stack.pop();
    }

    // Navigate to the clicked breadcrumb's path
    navigate(path);
    // Remove all breadcrumbs after the clicked index from the navigation stack
    if (stack.length > clickedIndex + 1) {
      stack.splice(clickedIndex + 1, stack.length - clickedIndex - 1);
      sessionStorage.setItem('navigation_stack', JSON.stringify(stack));
    }
    // Update the breadcrumbs to remove all items after the clicked index
    const updatedBreadcrumbs = breadcrumbs.slice(0, clickedIndex + 1);
    setBreadcrumbs(updatedBreadcrumbs);
  };

  return (
    <ul className="breadcrumbs">
      {breadcrumbs.map((breadcrumb, index) => (
        <li key={index}>
          {breadcrumbs.length > 0 && index < breadcrumbs.length - 1 ? (
            <>
              <a
                type="button"
                className="btn btn-link p-0 text-decoration-none"
                onClick={(e) => handleBreadcrumbClick(e, breadcrumb.path)}
              >
                {breadcrumb.label}
              </a>{' '}
              &#62; &nbsp;
            </>
          ) : (
            breadcrumb.label
          )}
        </li>
      ))}
    </ul>
  );
}

export { Breadcrumbs };
