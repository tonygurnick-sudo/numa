/**
 * FolderTreeSelector - A graphical folder tree selector for choosing destination folders
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { listFolder, type FileScope, type FolderContents } from '../Services/filesService';

interface FolderTreeSelectorProps {
  selectedPath: string;
  onPathChange: (path: string) => void;
  scope: FileScope;
}

interface TreeNode {
  name: string;
  path: string;
  expanded: boolean;
  loading: boolean;
  children: TreeNode[];
  hasChildren: boolean; // true if we know there are subfolders
}

export const FolderTreeSelector: React.FC<FolderTreeSelectorProps> = ({ selectedPath, onPathChange, scope }) => {
  const { t } = useTranslation('common');
  const [rootNode, setRootNode] = useState<TreeNode>({
    name: 'Root',
    path: '/',
    expanded: true,
    loading: true,
    children: [],
    hasChildren: false,
  });

  // Load folder contents for a given path
  const loadFolderContents = useCallback(
    async (path: string): Promise<FolderContents | null> => {
      try {
        return await listFolder(scope, path);
      } catch (error) {
        console.error('Failed to load folder contents:', error);
        return null;
      }
    },
    [scope]
  );

  // Convert folder items to tree nodes
  const foldersToTreeNodes = useCallback((folders: FolderContents['folders'], _parentPath: string): TreeNode[] => {
    return folders.map((folder) => ({
      name: folder.name,
      path: folder.path,
      expanded: false,
      loading: false,
      children: [],
      hasChildren: true, // Assume folders might have children until we check
    }));
  }, []);

  // Load initial root folders
  useEffect(() => {
    const loadRootFolders = async () => {
      setRootNode((prev) => ({ ...prev, loading: true }));
      const contents = await loadFolderContents('/');
      if (contents) {
        setRootNode((prev) => ({
          ...prev,
          loading: false,
          children: foldersToTreeNodes(contents.folders, '/'),
          hasChildren: contents.folders.length > 0,
        }));
      } else {
        setRootNode((prev) => ({ ...prev, loading: false }));
      }
    };

    loadRootFolders();
  }, [scope, loadFolderContents, foldersToTreeNodes]);

  // Expand/collapse a folder and load its children if needed
  const toggleFolder = useCallback(
    async (path: string) => {
      const updateNode = (node: TreeNode): TreeNode => {
        if (node.path === path) {
          if (node.expanded) {
            // Collapse
            return { ...node, expanded: false };
          } else {
            // Expand - load children if not already loaded
            return { ...node, expanded: true, loading: node.children.length === 0 };
          }
        }
        return {
          ...node,
          children: node.children.map(updateNode),
        };
      };

      setRootNode(updateNode);

      // Load children if expanding and not already loaded
      const findNode = (node: TreeNode): TreeNode | null => {
        if (node.path === path) return node;
        for (const child of node.children) {
          const found = findNode(child);
          if (found) return found;
        }
        return null;
      };

      const targetNode = findNode(rootNode);
      if (targetNode && !targetNode.expanded && targetNode.children.length === 0) {
        const contents = await loadFolderContents(path);
        if (contents) {
          const updateNodeWithChildren = (node: TreeNode): TreeNode => {
            if (node.path === path) {
              return {
                ...node,
                loading: false,
                children: foldersToTreeNodes(contents.folders, path),
                hasChildren: contents.folders.length > 0,
              };
            }
            return {
              ...node,
              children: node.children.map(updateNodeWithChildren),
            };
          };

          setRootNode(updateNodeWithChildren);
        }
      }
    },
    [rootNode, loadFolderContents, foldersToTreeNodes]
  );

  // Render a tree node
  const renderNode = useCallback(
    (node: TreeNode, depth: number = 0): React.JSX.Element => {
      const isSelected = node.path === selectedPath;
      const hasExpandableChildren = node.hasChildren || node.children.length > 0;

      return (
        <div key={node.path}>
          <div
            className={`d-flex align-items-center py-1 px-2 ${isSelected ? 'bg-primary text-white' : 'hover-bg-light'}`}
            style={{
              paddingLeft: `${depth * 20 + 8}px`,
              cursor: 'pointer',
              borderRadius: '4px',
              margin: '1px 0',
            }}
            onClick={() => onPathChange(node.path)}
          >
            {hasExpandableChildren && (
              <i
                className={`bi ${node.expanded ? 'bi-chevron-down' : 'bi-chevron-right'} me-1`}
                style={{ fontSize: '12px', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(node.path);
                }}
              />
            )}
            {!hasExpandableChildren && <span style={{ width: '16px' }} />}
            {node.loading ? (
              <span className="spinner-border spinner-border-sm me-2" />
            ) : (
              <i className="bi bi-folder me-2" />
            )}
            <span>{node.name}</span>
          </div>
          {node.expanded && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    },
    [selectedPath, onPathChange, toggleFolder]
  );

  return (
    <div>
      <div className="mb-2">
        <strong>{t('resultRenderer.actions.selectFolder')}:</strong>
      </div>
      <div
        className="border rounded p-2"
        style={{
          height: '300px',
          overflowY: 'auto',
          backgroundColor: '#f8f9fa',
        }}
      >
        {rootNode.loading && rootNode.children.length === 0 ? (
          <div className="text-center py-3">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading folders...
          </div>
        ) : (
          renderNode(rootNode)
        )}
      </div>
      <div className="mt-2 small text-muted">{t('folderTreeSelector.selected', { path: selectedPath || '/' })}</div>
    </div>
  );
};
