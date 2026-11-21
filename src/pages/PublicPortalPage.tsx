import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Article, LiveUpdate, Category } from '../types';
import { initialArticles, initialLiveUpdates } from '../data/initialData';
import { api } from '../services/api';
import { Navbar } from '../components/Navbar';
import { BreakingTicker } from '../components/BreakingTicker';
import { HeroSection } from '../components/HeroSection';
import { StateNewsSection } from '../components/StateNewsSection';
import { VideoNewsSection } from '../components/VideoNewsSection';
import { EditorsSection } from '../components/EditorsSection';
import { CategorySection } from '../components/CategorySection';
import { ArticleCard } from '../components/ArticleCard';
import { ArticleReaderModal } from '../components/ArticleReaderModal';
import { LiveFeedTimeline } from '../components/LiveFeedTimeline';
import { Footer } from '../components/Footer';
import { SidebarMenuDrawer } from '../components/SidebarMenuDrawer';
import { EPaperModal } from '../components/EPaperModal';

export function PublicPortalPage() {
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [liveUpdates, setLiveUpdates] = useState<LiveUpdate[]>(initialLiveUpdates);

  const [selectedCategory, setSelectedCategory] = useState<Category>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [isLiveFeedOpen, setIsLiveFeedOpen] = useState<boolean>(false);
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = useState<boolean>(false);
  const [isEPaperOpen, setIsEPaperOpen] = useState<boolean>(false);
  const [isRefreshingLive, setIsRefreshingLive] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      const [fetchedArticles, fetchedUpdates] = await Promise.allSettled([
        api.getArticles(),
        api.getLiveUpdates(),
      ]);

      if (fetchedArticles.status === 'fulfilled' && fetchedArticles.value.length > 0) {
        setArticles(fetchedArticles.value);
      }
      if (fetchedUpdates.status === 'fulfilled' && fetchedUpdates.value.length > 0) {
        setLiveUpdates(fetchedUpdates.value);
      }
    } catch (err) {
      console.warn('Using local fallback seed data', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Periodic background refresh for live updates every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updates = await api.getLiveUpdates();
        if (updates && updates.length > 0) {
          setLiveUpdates(updates);
        }
      } catch {
        // silent refresh catch
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefreshLive = async () => {
    setIsRefreshingLive(true);
    try {
      const fresh = await api.getLiveUpdates();
      setLiveUpdates(fresh);
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setIsRefreshingLive(false), 600);
    }
  };

  const publishedArticles = useMemo(() => {
    return articles.filter((a) => a.status === 'published');
  }, [articles]);

  const leadArticle = useMemo(() => {
    return (
      publishedArticles.find((a) => a.id === 'art-mohali-1') ||
      publishedArticles.find((a) => a.isFeatured) ||
      publishedArticles[0]
    );
  }, [publishedArticles]);

  const articlesByCategory = useMemo(() => {
    const map: Record<Exclude<Category, 'All' | 'ताज़ातरीन'>, Article[]> = {
      देश: [],
      शहर: [],
      क्रिकेट: [],
      विदेश: [],
      कारोबार: [],
      तकनीक: [],
      मनोरंजन: [],
      लाइफस्टाइल: [],
      संपादकीय: [],
    };

    publishedArticles.forEach((art) => {
      const cat = art.category as Exclude<Category, 'All' | 'ताज़ातरीन'>;
      if (map[cat]) {
        map[cat].push(art);
      }
    });

    return map;
  }, [publishedArticles]);

  const filteredArticles = useMemo(() => {
    return publishedArticles.filter((art) => {
      if (selectedCategory !== 'All' && selectedCategory !== 'ताज़ातरीन' && art.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = art.title.toLowerCase().includes(q);
        const matchSummary = art.summary.toLowerCase().includes(q);
        const matchContent = art.content.toLowerCase().includes(q);
        const matchAuthor = art.author.name.toLowerCase().includes(q);
        const matchTag = art.tags.some((t) => t.toLowerCase().includes(q));
        const matchLocation = art.location?.toLowerCase().includes(q);
        return matchTitle || matchSummary || matchContent || matchAuthor || matchTag || matchLocation;
      }
      return true;
    });
  }, [publishedArticles, selectedCategory, searchQuery]);

  const relatedArticles = useMemo(() => {
    if (!selectedArticle) return [];
    return publishedArticles
      .filter((a) => a.id !== selectedArticle.id && a.category === selectedArticle.category)
      .slice(0, 3);
  }, [publishedArticles, selectedArticle]);

  const handleSelectLiveUpdate = (update: LiveUpdate) => {
    if (update.linkArticleId) {
      const match = publishedArticles.find((a) => a.id === update.linkArticleId);
      if (match) {
        setSelectedArticle(match);
        return;
      }
    }
    setIsLiveFeedOpen(true);
  };

  const handleSelectArticleById = (articleId: string) => {
    const match = publishedArticles.find((a) => a.id === articleId);
    if (match) {
      setSelectedArticle(match);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-zinc-900 flex flex-col selection:bg-red-800 selection:text-white font-hindi-brand">
      {/* 1. Primary Masthead & Category Navigation (AKP News) */}
      <Navbar
        activeCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenLiveFeed={() => setIsLiveFeedOpen(true)}
        liveUpdatesCount={liveUpdates.length}
        onSelectSpecialTopic={(topic) => {
          setSearchQuery(topic);
        }}
        onOpenSidebarMenu={() => setIsSidebarMenuOpen(true)}
        onOpenEPaper={() => setIsEPaperOpen(true)}
      />

      {/* 2. Breaking News Wire Ticker (Hindi) */}
      <BreakingTicker
        updates={liveUpdates}
        onSelectUpdate={handleSelectLiveUpdate}
        onOpenLiveFeed={() => setIsLiveFeedOpen(true)}
      />

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-6">
        {(selectedCategory !== 'All' && selectedCategory !== 'ताज़ातरीन') || searchQuery.trim() ? (
          <div className="mb-8">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-2 border-red-700 mb-6">
              <div>
                <div className="text-xs font-bold text-red-700 uppercase tracking-wider mb-1">
                  {searchQuery ? 'खोज परिणाम (Search Results)' : 'संपादकीय डेस्क'}
                </div>
                <h1 className="text-2xl sm:text-4xl font-bold text-zinc-950">
                  {searchQuery
                    ? `"${searchQuery}" से संबंधित खबरें`
                    : `${selectedCategory} समाचार डेस्क`}
                </h1>
                <p className="text-xs sm:text-sm text-zinc-500 mt-1">
                  कुल {filteredArticles.length} सत्यापित खबरें उपलब्ध
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedCategory('All');
                  setSearchQuery('');
                }}
                className="flex items-center gap-1.5 text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>मुख्य पृष्ठ पर लौटें</span>
              </button>
            </div>

            {filteredArticles.length === 0 ? (
              <div className="text-center py-16 bg-white border border-zinc-200 rounded-2xl">
                <AlertCircle className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
                <h3 className="text-xl font-bold text-zinc-800">
                  कोई मेल खाती खबर नहीं मिली
                </h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                  कृपया अलग कीवर्ड खोजें या ऊपर दिए गए नेविगेशन में अन्य डेस्क ब्राउज़ करें।
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredArticles.map((article, idx) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    variant={idx === 0 ? 'horizontal' : 'standard'}
                    onSelect={setSelectedArticle}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <HeroSection
              leadArticle={leadArticle}
              articles={publishedArticles}
              liveUpdates={liveUpdates}
              onSelectArticle={setSelectedArticle}
              onSelectLiveUpdate={handleSelectLiveUpdate}
              onOpenLiveFeed={() => setIsLiveFeedOpen(true)}
            />

            <StateNewsSection onSelectArticle={setSelectedArticle} />

            <VideoNewsSection />

            <CategorySection
              category="देश"
              articles={articlesByCategory['देश']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="शहर"
              articles={articlesByCategory['शहर']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="क्रिकेट"
              articles={articlesByCategory['क्रिकेट']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="कारोबार"
              articles={articlesByCategory['कारोबार']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="मनोरंजन"
              articles={articlesByCategory['मनोरंजन']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="तकनीक"
              articles={articlesByCategory['तकनीक']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="विदेश"
              articles={articlesByCategory['विदेश']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <CategorySection
              category="संपादकीय"
              articles={articlesByCategory['संपादकीय']}
              onSelectArticle={setSelectedArticle}
              onSelectCategory={setSelectedCategory}
            />

            <EditorsSection />
          </>
        )}
      </main>

      {/* Editorial Footer */}
      <Footer
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenLiveFeed={() => setIsLiveFeedOpen(true)}
      />

      {/* MODALS */}
      <ArticleReaderModal
        article={selectedArticle}
        onClose={() => setSelectedArticle(null)}
        onSelectArticle={setSelectedArticle}
        relatedArticles={relatedArticles}
      />

      <LiveFeedTimeline
        isOpen={isLiveFeedOpen}
        onClose={() => setIsLiveFeedOpen(false)}
        updates={liveUpdates}
        onSelectUpdate={handleSelectLiveUpdate}
        onSelectArticleById={handleSelectArticleById}
        onRefresh={handleRefreshLive}
        isRefreshing={isRefreshingLive}
      />

      <SidebarMenuDrawer
        isOpen={isSidebarMenuOpen}
        onClose={() => setIsSidebarMenuOpen(false)}
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          setSearchQuery('');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onSelectTopic={(topic) => {
          setSearchQuery(topic);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenEPaper={() => setIsEPaperOpen(true)}
      />

      <EPaperModal
        isOpen={isEPaperOpen}
        onClose={() => setIsEPaperOpen(false)}
      />
    </div>
  );
}
