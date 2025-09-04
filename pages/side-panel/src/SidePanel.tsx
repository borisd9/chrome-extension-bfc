import '@src/SidePanel.css';
import { t } from '@extension/i18n';
import { PROJECT_URL_OBJECT, useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, biEventsStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui';
import { useState, useEffect } from 'react';
import type { BIEvent, EventMapping } from '@extension/storage';

// Extend Window interface for element selector state
declare global {
  interface Window {
    _biElementSelectorCleanup?: (() => void) | null;
    _biElementSelectorActive?: boolean;
  }
}

// Function to be injected into the page for element selection
const startElementSelection = (eventId: string) => {
  // Comprehensive cleanup of any existing selection state
  const cleanup = () => {
    // Remove overlays and highlights
    const existingOverlay = document.getElementById('bi-element-selector-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    const existingHighlight = document.getElementById('bi-element-highlighter');
    if (existingHighlight) {
      existingHighlight.remove();
    }

    // Remove any existing banners
    const existingBanners = document.querySelectorAll('[style*="position: fixed"][style*="top: 20px"]');
    existingBanners.forEach(banner => banner.remove());

    // Remove any existing selection highlights
    const selectionHighlights = document.querySelectorAll('[style*="border: 2px solid #3b82f6"]');
    selectionHighlights.forEach(highlight => highlight.remove());

    // Reset cursor
    document.body.style.cursor = '';

    // Remove event listeners if they exist
    if (window._biElementSelectorCleanup) {
      window._biElementSelectorCleanup();
      window._biElementSelectorCleanup = null;
    }
  };

  // Clean up any existing selection first
  cleanup();

  // Prevent multiple selections from running
  if (window._biElementSelectorActive) {
    return;
  }
  window._biElementSelectorActive = true;

  let isSelecting = true;
  let currentHighlight: HTMLElement | null = null;

  // Create overlay for visual feedback
  const overlay = document.createElement('div');
  overlay.id = 'bi-element-selector-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(59, 130, 246, 0.1);
    z-index: 10000;
    pointer-events: none;
    cursor: crosshair;
  `;
  document.body.appendChild(overlay);

  // Create instructions banner
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #1f2937;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    z-index: 10001;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    max-width: 500px;
    text-align: center;
    line-height: 1.4;
  `;
  banner.innerHTML =
    'Click on an element to map it to your BI event.<br/>Hold <strong>Ctrl/Cmd</strong> to select parent elements.<br/>Press <strong>ESC</strong> to cancel.';
  document.body.appendChild(banner);

  const createHighlight = (element: Element) => {
    if (currentHighlight) {
      currentHighlight.remove();
    }

    const rect = element.getBoundingClientRect();
    const highlight = document.createElement('div');
    highlight.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: rgba(59, 130, 246, 0.3);
      border: 2px solid #3b82f6;
      pointer-events: none;
      z-index: 9999;
      box-sizing: border-box;
    `;
    document.body.appendChild(highlight);
    currentHighlight = highlight;
  };

  const getElementSelector = (element: Element) => {
    // Generate a unique selector for the element
    const tagName = element.tagName.toLowerCase();
    const id = element.id;
    const className = element.className?.toString().trim();
    const dataHook = element.getAttribute('data-hook');
    const text = element.textContent?.trim().slice(0, 50) || '';

    // Generate XPath
    const getXPath = (el: Element): string => {
      if (el.id) return `//*[@id="${el.id}"]`;

      let path = '';
      let current: Element | null = el;

      while (current && current !== document.documentElement) {
        let index = 1;
        let sibling = current.previousElementSibling;

        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }

        path = `/${current.tagName.toLowerCase()}[${index}]${path}`;
        current = current.parentElement;
      }

      return `/html${path}`;
    };

    // Generate full path with data-hooks from root to target element
    const getFullPathWithDataHooks = (el: Element): string => {
      const pathElements: string[] = [];
      let current: Element | null = el;

      // Collect all elements from target up to html
      const elements: Element[] = [];
      while (current && current !== document.documentElement) {
        elements.unshift(current); // Add to beginning to maintain order from root to target
        current = current.parentElement;
      }

      // Add html element at the beginning
      if (document.documentElement) {
        elements.unshift(document.documentElement);
      }

      // Build path with data-hooks
      elements.forEach(elem => {
        const tag = elem.tagName.toLowerCase();
        const elemDataHook = elem.getAttribute('data-hook');
        const elemId = elem.id;

        let pathPart = tag;

        // Add identifier in order of priority: id, data-hook, class
        if (elemId) {
          pathPart += `#${elemId}`;
        } else if (elemDataHook) {
          pathPart += `[data-hook="${elemDataHook}"]`;
        } else if (elem.className?.toString().trim()) {
          const classes = elem.className.toString().trim().split(/\s+/).slice(0, 2); // Limit to first 2 classes to avoid overly long selectors
          pathPart += `.${classes.join('.')}`;
        }

        pathElements.push(pathPart);
      });

      return pathElements.join(' > ');
    };

    // Generate array of all data-hooks in the path
    const getAllDataHooksInPath = (el: Element): Array<{ tagName: string; dataHook: string; level: number }> => {
      const dataHooks: Array<{ tagName: string; dataHook: string; level: number }> = [];
      let current: Element | null = el;
      let level = 0;

      // Traverse up the DOM tree
      while (current && current !== document.documentElement) {
        const currentDataHook = current.getAttribute('data-hook');
        if (currentDataHook) {
          dataHooks.unshift({
            // Add to beginning to maintain order from root to target
            tagName: current.tagName.toLowerCase(),
            dataHook: currentDataHook,
            level,
          });
        }
        current = current.parentElement;
        level++;
      }

      return dataHooks;
    };

    // Original simple selector for backwards compatibility
    let selector = tagName;
    if (id) selector += `#${id}`;
    else if (dataHook) selector += `[data-hook="${dataHook}"]`;
    else if (className) selector += `.${className.split(' ').join('.')}`;

    return {
      selector,
      fullPath: getFullPathWithDataHooks(element),
      dataHooksPath: getAllDataHooksInPath(element),
      xpath: getXPath(element),
      tagName,
      className: className || undefined,
      id: id || undefined,
      dataHook: dataHook || undefined,
      text: text || undefined,
    };
  };

  const getTargetElement = (x: number, y: number, useModifier: boolean): Element | null => {
    const element = document.elementFromPoint(x, y);
    if (!element || element === overlay || element === banner || element === currentHighlight) {
      return null;
    }

    // If modifier key is pressed, try to find a meaningful parent element
    if (useModifier && element) {
      // Traverse up to find a parent element that looks like a meaningful container
      let current = element.parentElement;
      let bestCandidate = element;

      while (current && current !== document.body) {
        // Prefer elements with data-hook attributes (common in this app)
        if (current.hasAttribute('data-hook')) {
          bestCandidate = current;
          break;
        }

        // Prefer elements with meaningful class names (like card, container, etc.)
        const className = current.className;
        if (
          className &&
          (className.includes('Card__') ||
            className.includes('Container__') ||
            className.includes('Wrapper__') ||
            className.includes('__card') ||
            className.includes('__wrapper') ||
            className.includes('__container'))
        ) {
          bestCandidate = current;
          break;
        }

        // Also consider elements that are significantly larger than the original
        const originalRect = element.getBoundingClientRect();
        const currentRect = current.getBoundingClientRect();
        const areaDiff = (currentRect.width * currentRect.height) / (originalRect.width * originalRect.height);

        if (areaDiff > 2) {
          // If parent is significantly larger
          bestCandidate = current;
        }

        current = current.parentElement;
      }

      return bestCandidate;
    }

    return element;
  };

  const updateBannerForModifier = (isModifierPressed: boolean) => {
    if (isModifierPressed) {
      banner.style.background = '#059669'; // Green background when in parent selection mode
      banner.innerHTML =
        '<strong>Parent Selection Mode</strong><br/>Release Ctrl/Cmd to select child elements.<br/>Press <strong>ESC</strong> to cancel.';
    } else {
      banner.style.background = '#1f2937'; // Original background
      banner.innerHTML =
        'Click on an element to map it to your BI event.<br/>Hold <strong>Ctrl/Cmd</strong> to select parent elements.<br/>Press <strong>ESC</strong> to cancel.';
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isSelecting) return;

    const isModifierPressed = e.ctrlKey || e.metaKey;
    updateBannerForModifier(isModifierPressed);

    const element = getTargetElement(e.clientX, e.clientY, isModifierPressed);
    if (element) {
      createHighlight(element);
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (!isSelecting) return;

    e.preventDefault();
    e.stopPropagation();

    const isModifierPressed = e.ctrlKey || e.metaKey;
    const element = getTargetElement(e.clientX, e.clientY, isModifierPressed);
    if (element) {
      const elementSelector = getElementSelector(element);

      // Send the selection back to the side panel
      chrome.runtime.sendMessage({
        type: 'ELEMENT_SELECTED',
        eventId,
        element: elementSelector,
        url: window.location.href,
      });

      cleanupSelection();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      chrome.runtime.sendMessage({
        type: 'SELECTION_CANCELLED',
      });
      cleanupSelection();
    }
  };

  const cleanupSelection = () => {
    isSelecting = false;
    window._biElementSelectorActive = false;

    if (currentHighlight) currentHighlight.remove();
    if (overlay) overlay.remove();
    if (banner) banner.remove();

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown);
    document.body.style.cursor = '';

    // Clear the cleanup function reference
    window._biElementSelectorCleanup = null;
  };

  // Store cleanup function reference for external cleanup
  window._biElementSelectorCleanup = cleanupSelection;

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown);
  document.body.style.cursor = 'crosshair';
};

// Function to highlight a specific element on the page
const highlightElement = (elementSelector: {
  selector: string;
  xpath: string;
  tagName: string;
  className?: string;
  id?: string;
  dataHook?: string;
  text?: string;
}) => {
  // Remove any existing highlight
  const existingHighlight = document.getElementById('bi-element-highlighter');
  if (existingHighlight) {
    existingHighlight.remove();
  }

  let targetElement: Element | null = null;

  // Try to find element by ID first (most reliable)
  if (elementSelector.id) {
    targetElement = document.getElementById(elementSelector.id);
  }

  // If not found, try data-hook attribute
  if (!targetElement && elementSelector.dataHook) {
    try {
      targetElement = document.querySelector(`[data-hook="${elementSelector.dataHook}"]`);
    } catch {
      console.warn('Invalid data-hook selector:', elementSelector.dataHook);
    }
  }

  // If not found, try CSS selector
  if (!targetElement && elementSelector.selector) {
    try {
      targetElement = document.querySelector(elementSelector.selector);
    } catch {
      console.warn('Invalid CSS selector:', elementSelector.selector);
    }
  }

  // If still not found, try XPath
  if (!targetElement && elementSelector.xpath) {
    try {
      const result = document.evaluate(
        elementSelector.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      targetElement = result.singleNodeValue as Element;
    } catch {
      console.warn('Invalid XPath:', elementSelector.xpath);
    }
  }

  if (!targetElement) {
    // Show error message if element not found
    const errorBanner = document.createElement('div');
    errorBanner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #dc2626;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      z-index: 10001;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    `;
    errorBanner.textContent = 'Element not found on current page';
    document.body.appendChild(errorBanner);

    setTimeout(() => {
      if (errorBanner.parentNode) {
        errorBanner.parentNode.removeChild(errorBanner);
      }
    }, 3000);
    return;
  }

  // Scroll element into view
  targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setTimeout(() => {
    // Create highlight overlay
    const rect = targetElement.getBoundingClientRect();
    const highlight = document.createElement('div');
    highlight.id = 'bi-element-highlighter';
    highlight.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    background: rgba(34, 197, 94, 0.3);
    border: 3px solid #22c55e;
    pointer-events: none;
    z-index: 9999;
    box-sizing: border-box;
    animation: pulse 2s infinite;
  `;

    // Add pulsing animation
    const style = document.createElement('style');
    style.textContent = `
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }
  `;
    document.head.appendChild(style);

    document.body.appendChild(highlight);

    // Remove highlight after 5 seconds
    setTimeout(() => {
      if (highlight.parentNode) {
        highlight.parentNode.removeChild(highlight);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 3000);
  }, 500);
};

const SidePanel = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const { events, mappings, selectedEventId, isSelecting } = useStorage(biEventsStorage);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const logo = isLight ? 'side-panel/logo_vertical.svg' : 'side-panel/logo_vertical_dark.svg';

  useEffect(() => {
    // Get current tab URL
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.url) {
        setCurrentUrl(tabs[0].url);
      }
    });

    // Listen for messages from content script
    const handleMessage = (message: {
      type: string;
      eventId: string;
      element: {
        selector: string;
        xpath: string;
        tagName: string;
        className?: string;
        id?: string;
        dataHook?: string;
        text?: string;
      };
      url: string;
    }) => {
      if (message.type === 'ELEMENT_SELECTED') {
        biEventsStorage.addMapping(message.eventId, message.element, message.url);
      } else if (message.type === 'SELECTION_CANCELLED') {
        biEventsStorage.cancelSelection();
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const goGithubSite = () => chrome.tabs.create(PROJECT_URL_OBJECT);

  const handleEventClick = async (eventId: string) => {
    if (selectedEventId === eventId) {
      // Deselect if clicking the same event
      await biEventsStorage.cancelSelection();
      // Also cleanup any active selection on the page
      chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
        if (tabs[0]?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              // Cleanup any existing selection
              const existingOverlay = document.getElementById('bi-element-selector-overlay');
              if (existingOverlay) {
                existingOverlay.remove();
              }
              const existingBanner = document.querySelector('[style*="position: fixed"][style*="top: 20px"]');
              if (existingBanner) {
                existingBanner.remove();
              }
              const existingHighlight = document.getElementById('bi-element-highlighter');
              if (existingHighlight) {
                existingHighlight.remove();
              }
              // Reset cursor
              document.body.style.cursor = '';
            },
          });
        }
      });
    } else {
      // Always cancel existing selection first, then start new selection
      await biEventsStorage.cancelSelection();

      // Small delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now select new event and start element selection
      await biEventsStorage.selectEvent(eventId);

      // Inject content script to handle element selection
      chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
        if (tabs[0]?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: startElementSelection,
            args: [eventId],
          });
        }
      });
    }
  };

  const getEventMappings = (eventId: string): EventMapping[] =>
    mappings.filter(mapping => mapping.eventId === eventId && mapping.url === currentUrl);

  const handleRemoveMapping = async (eventId: string, elementSelector?: string) => {
    await biEventsStorage.removeMapping(eventId, currentUrl, elementSelector);
  };

  const toggleEventExpansion = (eventId: string) => {
    setExpandedEvents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const handleHighlightElement = async (elementSelector: {
    selector: string;
    xpath: string;
    tagName: string;
    className?: string;
    id?: string;
    dataHook?: string;
    text?: string;
  }) => {
    // Inject highlight function into current tab
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (tabs[0]?.id) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: highlightElement,
          args: [elementSelector],
        });
      }
    });
  };

  return (
    <div className={cn('min-h-screen', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <header className={cn('border-b p-4', isLight ? 'border-gray-200 bg-white' : 'border-gray-700 bg-gray-900')}>
        <div className="mb-4 flex items-center justify-between">
          <button onClick={goGithubSite} type="button">
            <img src={chrome.runtime.getURL(logo)} className="h-8 w-8" alt="logo" />
          </button>
          <ToggleButton onClick={exampleThemeStorage.toggle}>{t('toggleTheme')}</ToggleButton>
        </div>
        <h1 className={cn('text-xl font-bold', isLight ? 'text-gray-900' : 'text-white')}>BI Event Mapper</h1>
        {currentUrl && (
          <p className={cn('mt-1 text-sm', isLight ? 'text-gray-600' : 'text-gray-400')}>
            {new URL(currentUrl).hostname}
          </p>
        )}
        {isSelecting && (
          <div
            className={cn(
              'mt-2 rounded p-2',
              isLight ? 'bg-yellow-100 text-yellow-800' : 'bg-yellow-900 text-yellow-200',
            )}>
            <p className="text-sm font-medium">Click on an element in the page to map it to the selected event</p>
            <button
              onClick={() => biEventsStorage.cancelSelection()}
              className={cn(
                'mt-1 rounded px-2 py-1 text-xs',
                isLight ? 'bg-yellow-200 hover:bg-yellow-300' : 'bg-yellow-800 hover:bg-yellow-700',
              )}
              type="button">
              Cancel Selection
            </button>
          </div>
        )}
      </header>

      <div className="p-4">
        <div className="space-y-3">
          {events.map((event: BIEvent) => {
            const eventMappings = getEventMappings(event.evid);
            const isSelected = selectedEventId === event.evid;
            const hasMapping = eventMappings.length > 0;
            const isExpanded = expandedEvents.has(event.evid);
            console.log(`🎯 Rendering event ${event.evid} (${event.trigger}): isExpanded=${isExpanded}`);

            return (
              <div
                key={event.evid}
                className={cn(
                  'group rounded-lg border transition-all',
                  isSelected
                    ? isLight
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-blue-400 bg-blue-950'
                    : hasMapping
                      ? isLight
                        ? 'border-green-300 bg-green-50'
                        : 'border-green-600 bg-green-950'
                      : isLight
                        ? 'border-gray-200 bg-white'
                        : 'border-gray-700 bg-gray-900',
                )}>
                {/* Event Header - Always Visible */}
                <div className="flex items-start justify-between p-3">
                  <div className="min-w-0 flex-1">
                    {/* Event Title with Hover Selection Button */}
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className={cn('text-base font-medium', isLight ? 'text-gray-900' : 'text-white')}>
                        {event.trigger} Event
                        {isSelected && (
                          <span className={cn('ml-2 text-xs', isLight ? 'text-blue-600' : 'text-blue-400')}>●</span>
                        )}
                      </h3>

                      {/* Hover-only Selection Button */}
                      <button
                        onClick={() => handleEventClick(event.evid)}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100',
                          isSelected
                            ? isLight
                              ? 'border-blue-300 bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'border-blue-600 bg-blue-900 text-blue-300 hover:bg-blue-800'
                            : isLight
                              ? 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                              : 'border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700',
                        )}
                        type="button"
                        title={isSelected ? 'Deselect event' : 'Select event for mapping'}>
                        {isSelected ? '✓' : '+'}
                      </button>

                      {/* Badges */}
                      <div className="ml-auto flex gap-1">
                        {hasMapping && (
                          <span
                            className={cn(
                              'rounded-full px-2 py-1 text-xs',
                              isLight ? 'bg-green-100 text-green-800' : 'bg-green-900 text-green-200',
                            )}>
                            ✓ Mapped
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Event Description (when collapsed) */}
                    {!isExpanded && (
                      <div>
                        <p className={cn('text-sm', isLight ? 'text-gray-600' : 'text-gray-400')}>
                          {event.description}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Expand/Collapse Button */}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      toggleEventExpansion(event.evid);
                    }}
                    className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                      isLight ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 hover:bg-gray-700',
                    )}
                    type="button"
                    title={isExpanded ? 'Collapse details' : 'Expand details'}>
                    <svg
                      className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Expandable Content */}
                {isExpanded && (
                  <div className={cn('border-t px-3 pb-3', isLight ? 'border-gray-200' : 'border-gray-700')}>
                    <div className="space-y-4 pt-3">
                      {/* Event Properties */}
                      <div>
                        <h4 className={cn('mb-2 text-sm font-medium', isLight ? 'text-gray-900' : 'text-white')}>
                          Event Properties
                        </h4>
                        <div className="space-y-3">
                          <div className="flex">
                            <span
                              className={cn(
                                'w-24 flex-shrink-0 font-mono text-xs',
                                isLight ? 'text-gray-500' : 'text-gray-500',
                              )}>
                              description:
                            </span>
                            <span className={cn('font-mono text-xs', isLight ? 'text-gray-900' : 'text-gray-100')}>
                              {event.description}
                            </span>
                          </div>

                          {event.staticProperties && Object.keys(event.staticProperties).length > 0 && (
                            <div>
                              <div className="flex">
                                <span
                                  className={cn(
                                    'w-24 flex-shrink-0 font-mono text-xs',
                                    isLight ? 'text-gray-500' : 'text-gray-500',
                                  )}>
                                  staticProperties:
                                </span>
                                <span className={cn('font-mono text-xs', isLight ? 'text-gray-900' : 'text-gray-100')}>
                                  {/* Empty span to maintain layout */}
                                </span>
                              </div>
                              <div className="ml-24 mt-1 space-y-1">
                                {Object.entries(event.staticProperties).map(([key, value]) => (
                                  <div key={key} className="flex">
                                    <span
                                      className={cn(
                                        'w-32 flex-shrink-0 font-mono text-xs',
                                        isLight ? 'text-gray-400' : 'text-gray-400',
                                      )}>
                                      {key}:
                                    </span>
                                    <span
                                      className={cn('font-mono text-xs', isLight ? 'text-gray-900' : 'text-gray-100')}>
                                      {value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Element Mappings */}
                      {eventMappings.length > 0 && (
                        <div>
                          <h4 className={cn('mb-2 text-sm font-medium', isLight ? 'text-gray-900' : 'text-white')}>
                            Element Mappings ({eventMappings.length})
                          </h4>
                          <div className="space-y-2">
                            {eventMappings.map((mapping, index) => (
                              <div
                                key={index}
                                className={cn('rounded p-3 text-xs', isLight ? 'bg-gray-100' : 'bg-gray-800')}>
                                <div className="space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      {/* Original selector (kept for compatibility) */}
                                      <p
                                        className={cn(
                                          'break-all font-mono text-xs',
                                          isLight ? 'text-gray-700' : 'text-gray-300',
                                        )}>
                                        {mapping.element.tagName.toLowerCase()}
                                        {mapping.element.id && `#${mapping.element.id}`}
                                        {mapping.element.dataHook && `[data-hook="${mapping.element.dataHook}"]`}
                                        {mapping.element.className &&
                                          `.${mapping.element.className.split(' ').join('.')}`}
                                      </p>

                                      {/* Data-hooks path */}
                                      {mapping.element.dataHooksPath && mapping.element.dataHooksPath.length > 0 && (
                                        <div className="mt-2">
                                          <p
                                            className={cn(
                                              'text-xs font-semibold',
                                              isLight ? 'text-green-700' : 'text-green-300',
                                            )}>
                                            Data-hooks path ({mapping.element.dataHooksPath.length}):
                                          </p>
                                          <div className="space-y-1">
                                            {mapping.element.dataHooksPath.map((hook, index) => (
                                              <p
                                                key={index}
                                                className={cn(
                                                  'break-all pl-2 font-mono text-xs',
                                                  isLight ? 'text-green-600' : 'text-green-400',
                                                )}>
                                                {`${hook.tagName}[data-hook="${hook.dataHook}"] (level ${hook.level})`}
                                              </p>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {mapping.element.text && (
                                        <p
                                          className={cn(
                                            'mt-1 break-words text-xs',
                                            isLight ? 'text-gray-600' : 'text-gray-400',
                                          )}>
                                          &quot;{mapping.element.text.slice(0, 50)}
                                          {mapping.element.text.length > 50 ? '...' : ''}&quot;
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleHighlightElement(mapping.element)}
                                        className={cn(
                                          'flex-shrink-0 rounded px-2 py-1 text-xs font-medium',
                                          isLight
                                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                            : 'bg-green-900 text-green-300 hover:bg-green-800',
                                        )}
                                        type="button"
                                        title="Highlight element in page">
                                        👁
                                      </button>
                                      <button
                                        onClick={() => handleRemoveMapping(event.evid, mapping.element.selector)}
                                        className={cn(
                                          'flex-shrink-0 rounded px-2 py-1 text-xs font-medium',
                                          isLight
                                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                            : 'bg-red-900 text-red-300 hover:bg-red-800',
                                        )}
                                        type="button"
                                        title="Remove mapping">
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
