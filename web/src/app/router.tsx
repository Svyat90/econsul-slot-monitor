import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { Layout } from './Layout.tsx';
import { MonitoringPage } from './pages/MonitoringPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SlotsPage } from './pages/SlotsPage.tsx';

export const routes: RouteObject[] = [
    {
        path: '/',
        element: <Layout />,
        children: [
            { index: true, element: <Navigate to="/slots" replace /> },
            { path: 'slots', element: <SlotsPage /> },
            { path: 'monitoring', element: <MonitoringPage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: '*', element: <Navigate to="/slots" replace /> },
        ],
    },
];

export const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL });
