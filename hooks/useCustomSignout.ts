import { useRouter } from 'next/router';
import { clearPwaState } from '@/lib/pwa';

export function useCustomSignOut() {
  const router = useRouter();

  const signOut = async () => {
    try {
      const response = await fetch('/api/auth/custom-signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Signout failed');
      }

      await clearPwaState();
      router.push('/auth/login');
    } catch (error) {
      console.error('Error during sign out:', error);
    }
  };

  return signOut;
}
