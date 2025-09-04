import { createStorage, StorageEnum } from '../base/index.js';

interface BIEvent {
  evid: string;
  description: string;
  trigger: string;
  staticProperties?: {
    [key: string]: string;
  };
}

interface ElementSelector {
  selector: string;
  xpath: string;
  tagName: string;
  className?: string;
  id?: string;
  dataHook?: string;
  text?: string;
}

interface EventMapping {
  eventId: string;
  element: ElementSelector;
  url: string;
  timestamp: number;
}

interface BIEventsState {
  events: BIEvent[];
  mappings: EventMapping[];
  selectedEventId: string | null;
  isSelecting: boolean;
}

// Default BI events
const defaultEvents: BIEvent[] = [
  {
    evid: 'button_click',
    trigger: 'click',
    description: 'Track button clicks and CTA interactions',
    staticProperties: {
      event_category: 'user_action',
      element_type: 'button',
    },
  },
  {
    evid: 'form_submit',
    trigger: 'submit',
    description: 'Track form submissions and conversions',
    staticProperties: {
      event_category: 'conversion',
      element_type: 'form',
    },
  },
  {
    evid: 'link_click',
    trigger: 'click',
    description: 'Track internal and external link clicks',
    staticProperties: {
      event_category: 'user_action',
      element_type: 'link',
    },
  },
  {
    evid: 'page_scroll',
    trigger: 'scroll',
    description: 'Track user scroll behavior and engagement',
    staticProperties: {
      event_category: 'engagement',
      element_type: 'window',
    },
  },
  {
    evid: 'video_play',
    trigger: 'play',
    description: 'Track video player interactions',
    staticProperties: {
      event_category: 'engagement',
      element_type: 'video',
    },
  },
  {
    evid: 'file_download',
    trigger: 'click',
    description: 'Track file downloads and document access',
    staticProperties: {
      event_category: 'conversion',
      element_type: 'download_link',
    },
  },
  {
    evid: 'search_query',
    trigger: 'submit',
    description: 'Track internal search usage',
    staticProperties: {
      event_category: 'user_action',
      element_type: 'search_form',
    },
  },
  {
    evid: 'modal_open',
    trigger: 'click',
    description: 'Track modal and popup interactions',
    staticProperties: {
      event_category: 'engagement',
      element_type: 'modal_trigger',
    },
  },
];

const storage = createStorage<BIEventsState>(
  'bi-events-storage-key',
  {
    events: defaultEvents,
    mappings: [],
    selectedEventId: null,
    isSelecting: false,
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

const biEventsStorage = {
  ...storage,
  selectEvent: async (eventId: string | null) => {
    await storage.set(currentState => ({
      ...currentState,
      selectedEventId: eventId,
      isSelecting: eventId !== null,
    }));
  },
  addMapping: async (eventId: string, element: ElementSelector, url: string) => {
    await storage.set(currentState => {
      // Check if mapping already exists to prevent duplicates
      const existingMapping = currentState.mappings.find(
        mapping =>
          mapping.eventId === eventId &&
          mapping.url === url &&
          mapping.element.selector === element.selector &&
          mapping.element.xpath === element.xpath,
      );

      // If mapping already exists, don't add duplicate
      if (existingMapping) {
        return {
          ...currentState,
          selectedEventId: null,
          isSelecting: false,
        };
      }

      // Add new mapping
      return {
        ...currentState,
        mappings: [
          ...currentState.mappings,
          {
            eventId,
            element,
            url,
            timestamp: Date.now(),
          },
        ],
        selectedEventId: null,
        isSelecting: false,
      };
    });
  },
  removeMapping: async (eventId: string, url: string) => {
    await storage.set(currentState => ({
      ...currentState,
      mappings: currentState.mappings.filter(mapping => !(mapping.eventId === eventId && mapping.url === url)),
    }));
  },
  cancelSelection: async () => {
    await storage.set(currentState => ({
      ...currentState,
      selectedEventId: null,
      isSelecting: false,
    }));
  },
};

type BIEventsStorageType = typeof biEventsStorage;

export { biEventsStorage };
export type { BIEvent, ElementSelector, EventMapping, BIEventsState, BIEventsStorageType };
