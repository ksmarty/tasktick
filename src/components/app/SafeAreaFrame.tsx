import Box from '@mui/material/Box';

/**
 * Full-height page frame that respects every safe-area inset.
 *
 * A single wrapper rather than repeating the insets in every layout keeps the
 * Dynamic Island handling consistent — the one place where getting it wrong
 * produces content stuck under the notch.
 *
 * The insets are read straight from `env(safe-area-inset-*)`, which resolve to
 * `0px` off-device, so the frame is safe to use unconditionally. `className` is
 * forwarded for callers that compose their own layout on top.
 */
export function SafeAreaFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Box
      className={className}
      sx={{
        minHeight: '100dvh',
        pl: 'env(safe-area-inset-left, 0px)',
        pr: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {children}
    </Box>
  );
}
