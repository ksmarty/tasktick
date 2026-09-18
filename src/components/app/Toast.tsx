'use client';

/**
 * Transient banners.
 *
 * This is the MUI implementation — `Alert` for the surface, `Slide` for the
 * entrance and a `Stack` for the pile-up — behind the same public API the app
 * has always used (`useToast`, `toast({ title, description, variant })`), so no
 * call site had to change. That matters because toasts are fired from 22 places
 * including failure paths, and a migration that quietly drops an error banner is
 * worse than one that leaves the markup alone.
 *
 * The one behavioural difference from the hand-rolled version: MUI owns the
 * transition, so the exit is a `Slide` rather than a CSS keyframe, and the
 * removal timer is started on mount rather than by the provider.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import IconButton from '@mui/material/IconButton';
import Slide from '@mui/material/Slide';
import Stack from '@mui/material/Stack';
import Close from '@mui/icons-material/Close';

export type ToastVariant = 'success' | 'error' | 'info';

/** Any icon component; the app no longer depends on a specific icon library. */
type IconComponent = ComponentType<{ fontSize?: 'small' | 'inherit' | 'medium' | 'large' }>;

export interface ToastOptions {
  title: string;
  /** Optional second line with the detail. */
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. `0` keeps the banner until it is dismissed. */
  duration?: number;
  /** Optional single action rendered at the trailing edge. */
  action?: { label: string; onClick: () => void };
  /** Overrides the variant glyph. */
  icon?: IconComponent;
}

export interface ToastHandle {
  id: string;
  /** Removes this banner immediately. */
  dismiss: () => void;
}

export interface ToastContextValue {
  /** Shows a banner (a bare string is treated as `{ title }`). */
  toast: (options: ToastOptions | string) => ToastHandle;
  /** Dismisses one banner by id. */
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 3200;

interface ToastRecord extends ToastOptions {
  id: string;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** How many banners may be on screen at once. Oldest are dropped first. */
  max?: number;
}

export function ToastProvider({ children, max = 3 }: ToastProviderProps) {
  const [records, setRecords] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setRecords((current) => current.filter((record) => record.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions | string): ToastHandle => {
      const id = `toast-${nextId.current++}`;
      const record: ToastRecord = {
        variant: 'info',
        duration: DEFAULT_DURATION,
        ...(typeof options === 'string' ? { title: options } : options),
        id,
      };
      // Newest last, so the stack reads oldest-at-top like every other list here.
      setRecords((current) => [...current, record].slice(-max));
      return { id, dismiss: () => dismiss(id) };
    },
    [dismiss, max],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport records={records} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * The pile-up.
 *
 * Anchored above the bottom band rather than at the very bottom, so a banner
 * never covers the navigation or the action button — both of which sit in the
 * thumb zone and are the two things a user reaches for right after an action.
 */
function ToastViewport({
  records,
  onDismiss,
}: {
  records: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  return (
    <Stack
      spacing={1}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)',
        zIndex: (theme) => theme.zIndex.snackbar,
        px: 2,
        alignItems: 'center',
        pointerEvents: 'none',
        '@media (min-width: 1200px)': { bottom: '1.5rem' },
      }}
    >
      {records.map((record) => (
        <ToastItem key={record.id} record={record} onDismiss={onDismiss} />
      ))}
    </Stack>
  );
}

function ToastItem({
  record,
  onDismiss,
}: {
  record: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const { id, title, description, variant = 'info', duration = DEFAULT_DURATION, action, icon } = record;

  useEffect(() => {
    if (!duration) return;
    const timer = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, id, onDismiss]);

  return (
    <Slide direction="up" in appear>
      <Alert
        severity={variant}
        icon={icon ? <IconComponentWrapper icon={icon} /> : undefined}
        variant="filled"
        elevation={6}
        sx={{ width: '100%', maxWidth: 480, pointerEvents: 'auto', alignItems: 'center' }}
        action={
          <>
            {action ? (
              <IconButton
                size="small"
                color="inherit"
                onClick={() => {
                  action.onClick();
                  onDismiss(id);
                }}
                sx={{ fontWeight: 600 }}
              >
                {action.label}
              </IconButton>
            ) : null}
            <IconButton size="small" color="inherit" aria-label="Dismiss" onClick={() => onDismiss(id)}>
              <Close fontSize="small" />
            </IconButton>
          </>
        }
      >
        {description ? <AlertTitle>{title}</AlertTitle> : title}
        {description ?? null}
      </Alert>
    </Slide>
  );
}

function IconComponentWrapper({ icon: Icon }: { icon: IconComponent }) {
  return <Icon fontSize="small" />;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
