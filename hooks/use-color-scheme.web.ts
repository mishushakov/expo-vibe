import { useEffect, useState } from 'react';

import { useAppColorScheme } from '@/components/theme-context';

export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useAppColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
