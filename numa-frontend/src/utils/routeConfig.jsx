import { reloadFavourites } from './navigation';
import { Dash } from '../Pages/Dash';
import AppDetail from '../Pages/AppDetail';
import UserManagement from '../Pages/UserManagement';
import { NumaChat } from '../Pages/NumaChat';
import { S3Uploader } from '../Pages/S3Uploader';
import { CompanyInfo } from '../Pages/CompanyInfo';

export const ROUTE_CONFIG = [
  {
    path: '/dash',
    element: () => <Dash />,
    nav: { label: 'Dash', icon: 'bi bi-grid-1x2-fill' },
  },
  {
    path: '/favourite-apps',
    element: (navigate) => <Dash onClick={() => reloadFavourites(navigate)} showFavorites />,
    nav: { label: 'Favs', icon: 'bi bi-star-fill' },
  },
  {
    path: '/app/:appId',
    element: () => <AppDetail />, // no nav entry
  },
  {
    path: '/upload',
    element: () => <S3Uploader />,
    requiredFeature: 'editCompanyData',
    nav: { label: 'Files', icon: 'bi bi-cloud-upload-fill' },
  },
  {
    path: '/chat',
    element: () => <NumaChat />,
    requiredFeature: 'chat',
    nav: { label: 'Chat', icon: 'bi bi-chat-dots-fill' },
  },
  {
    path: '/company-info',
    element: () => <CompanyInfo />,
    requiredFeature: 'editCompanyData',
    nav: { label: 'Company', icon: 'bi bi-building-fill' },
  },
  {
    path: '/user-management',
    element: () => <UserManagement />,
    requiredFeature: 'manageUsers',
    nav: { label: 'User Management', icon: 'bi bi-people-fill', footerOnly: true },
  },
];
