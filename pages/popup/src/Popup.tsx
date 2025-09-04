import '@src/Popup.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui';

const Popup = () => {
  const { isLight } = useStorage(exampleThemeStorage);

  const openSidePanel = async () => {
    try {
      const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
      if (tab.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  };

  return (
    <div className={cn('App', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <ToggleButton onClick={openSidePanel}>Select eventssss</ToggleButton>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
