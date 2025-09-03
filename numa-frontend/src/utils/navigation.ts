// Navigation utilities

/**
 * Reloads the favorites page
 * @param {Function} navigate - React Router navigate function
 */
export const reloadFavourites = (navigate) => {
  navigate('/favourite-apps');
  window.location.reload();
};
