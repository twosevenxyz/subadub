
// console.log('content script starting');

const el = document.createElement('script');
el.text = `
(function initializeSubadub() {
  const POLL_INTERVAL_MS = 500;
  const WEBVTT_FMT = 'webvtt-lssdh-ios8';
  const URL_MOVIEID_REGEX = RegExp('/watch/([0-9]+)');
  const trackListCache = new Map(); // from movie ID to list of available tracks
  const webvttCache = new Map(); // from 'movieID/trackID' to blob
  let urlMovieId;
  let selectedTrackId;
  
  let targetSubsList = null;
  let displayedSubsList = null;

  let targetTrackBlob = null;
  let displayedTrackBlob = null;

  function extractMovieTextTracks(movieObj) {
    const movieId = movieObj.movieId;

    const usableTracks = [];
    console.log('timedtexttracks', movieObj.timedtexttracks);
    for (const track of movieObj.timedtexttracks) {
      if (track.isForcedNarrative || track.isNoneTrack) {
        continue; // don't want these
      }

      if (!track.cdnlist || !track.cdnlist.length) {
        continue;
      }
      const firstCdnId = track.cdnlist[0].id;

      if (!track.ttDownloadables) {
        continue;
      }

      const webvttDL = track.ttDownloadables[WEBVTT_FMT];
      if (!webvttDL || !webvttDL.downloadUrls) {
        continue;
      }

      const bestUrl = webvttDL.downloadUrls[firstCdnId];
      if (!bestUrl) {
        continue;
      }

      const isClosedCaptions = track.rawTrackType === 'closedcaptions';

      usableTracks.push({
        id: track.new_track_id,
        language: track.language,
        languageDescription: track.languageDescription,
        bestUrl: bestUrl,
        isClosedCaptions: isClosedCaptions,
      });
    }

    console.log('CACHING MOVIE TRACKS', movieId, usableTracks);
    trackListCache.set(movieId, usableTracks);
    renderAndReconcile();
  }

  function fetchWebvtt(movieId, trackInfo) {
  }

  function handleSubsListSetOrChange(selectElem) {
    const trackId = selectElem.value;
    console.log('selecting track', trackId);

    selectedTrackId = trackId;

    if (!selectedTrackId) {
      return;
    }

    const movieId = urlMovieId; // this seems a bit hacky to get this way, but should be OK
    const trackList = trackListCache.get(movieId);
    const matchingTracks = trackList.filter(el => el.id === trackId);
    if (matchingTracks.length !== 1) {
      throw new Error('internal error, no matching track id');
    }
    const trackInfo = matchingTracks[0];

    const cacheKey = movieId + '/' + trackInfo.id;
    if (!webvttCache.has(cacheKey)) {
      const url = trackInfo.bestUrl;

      fetch(url).then(function(response) {
        if (response.ok) {
          return response.blob();
        }
        throw new Error('Bad response to WebVTT request');
      }).then(function(blob) {
        webvttCache.set(cacheKey, new Blob([blob], {type: 'text/vtt'})); // set type to avoid warning
        renderAndReconcile();
      }).catch(function(error) {
        console.log('Failed to fetch WebVTT file', error.message);
      });
    }

    // NOTE: We don't call renderAndReconcile here, caller should do it to avoid recursive loop bug
  }

  function renderAndReconcile() {
    const SUBS_LIST_ELEM_ID = 'subadub-subs-list';
    const TRACK_ELEM_ID = 'subadub-track';

    function addSubsList(tracks) {
      const selectElem = document.createElement('select');
      selectElem.style.cssText = 'color: black; margin: 5px';
      selectElem.addEventListener('change', function(e) {
        handleSubsListSetOrChange(e.target);
        renderAndReconcile();
      }, false);

      let firstCCTrackId;
      for (const track of tracks) {
        const optElem = document.createElement('option');
        optElem.value = track.id;
        optElem.textContent = track.languageDescription + (track.isClosedCaptions ? ' [CC]' : '');
        selectElem.appendChild(optElem);

        if (track.isClosedCaptions && !firstCCTrackId) {
          firstCCTrackId = track.id;
        }
      }
      if (firstCCTrackId) {
        selectElem.value = firstCCTrackId;
      }

      const downloadButtonElem = document.createElement('button');
      downloadButtonElem.textContent = 'Download';
      downloadButtonElem.style.cssText = 'color: black; margin: 5px; border: none';
      downloadButtonElem.addEventListener('click', function(e) {
        function formatTime(t) {
          const date = new Date(0, 0, 0, 0, 0, 0, t*1000);
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const seconds = date.getSeconds().toString().padStart(2, '0');
          const ms = date.getMilliseconds().toString().padStart(3, '0');

          return hours + ':' + minutes + ':' + seconds + ',' + ms;
        }

        e.preventDefault();
        console.log('download click');

        const trackElem = document.getElementById(TRACK_ELEM_ID);
        if (!trackElem || !trackElem.track || !trackElem.track.cues) {
          return;
        }

        const srtChunks = [];
        let idx = 1;
        for (const cue of trackElem.track.cues) {
          srtChunks.push(idx + '\\n' + formatTime(cue.startTime) + ' --> ' + formatTime(cue.endTime) + '\\n' + cue.text + '\\n\\n');
          idx++;
        }

        const srtBlob = new Blob(srtChunks, { type: 'text/srt' });
        const srtUrl = URL.createObjectURL(srtBlob);
        const srtName = 'foo.srt';

        const tmpElem = document.createElement('a');
        tmpElem.setAttribute('href', srtUrl);
        tmpElem.setAttribute('download', srtName);
        tmpElem.style.display = 'none';
        document.body.appendChild(tmpElem);
        tmpElem.click();
        document.body.removeChild(tmpElem);
      }, false);

      const panelElem = document.createElement('div');
      panelElem.style.cssText = 'position: absolute; z-index: 1000; top: 0; right: 0; font-size: 16px; color: white';
      panelElem.appendChild(selectElem);
      panelElem.appendChild(downloadButtonElem);

      const containerElem = document.createElement('div');
      containerElem.id = SUBS_LIST_ELEM_ID;
      containerElem.style.cssText = 'width: 100%; height: 100%; position: absolute; top: 0; right: 0; bottom: 0; left: 0';
      containerElem.appendChild(panelElem);

      document.body.appendChild(containerElem);

      handleSubsListSetOrChange(selectElem);
    }

    function removeSubsList() {
      const el = document.getElementById(SUBS_LIST_ELEM_ID);
      if (el) {
        el.remove();
      }
    }

    function addTrackElem(videoElem, blob) {
      const trackElem = document.createElement('track');
      trackElem.id = TRACK_ELEM_ID;
      trackElem.src = URL.createObjectURL(blob);
      trackElem.kind = 'subtitles';
      trackElem.default = true;
      // trackElem.mode = 'showing';
      videoElem.appendChild(trackElem);
    }

    function removeTrackElem() {
      const el = document.getElementById(TRACK_ELEM_ID);
      if (el) {
        el.remove();
      }
    }

    // Determine what subs list should be
    if (urlMovieId && (document.readyState === 'complete') && trackListCache.has(urlMovieId)) {
      targetSubsList = trackListCache.get(urlMovieId);
    } else {
      targetSubsList = null;
    }

    // Reconcile DOM if necessary
    if (targetSubsList !== displayedSubsList) {
      console.log('updating subs list DOM', targetSubsList, displayedSubsList);

      removeSubsList();
      if (targetSubsList) {
        addSubsList(targetSubsList);
      }

      displayedSubsList = targetSubsList;
    }

    // Determine what subs blob should be
    const videoElem = document.querySelector('video');
    if (urlMovieId && selectedTrackId && videoElem) {
      const cacheKey = urlMovieId + '/' + selectedTrackId;
      if (webvttCache.has(cacheKey)) {
        targetTrackBlob = webvttCache.get(cacheKey);
      } else {
        targetTrackBlob = null;
      }
    } else {
      targetTrackBlob = null;
    }

    // Reconcile DOM if necessary
    if (targetTrackBlob !== displayedTrackBlob) {
      console.log('need to update track blob', targetTrackBlob, displayedTrackBlob);

      removeTrackElem();
      if (targetTrackBlob) {
        addTrackElem(videoElem, targetTrackBlob);
      }

      displayedTrackBlob = targetTrackBlob;
    }
  }

  const originalStringify = JSON.stringify;
  JSON.stringify = function(value) {
    if (value && value.params && value.params.profiles) {
      value.params.profiles.unshift(WEBVTT_FMT);
      // console.log('stringify', value);
    }
    return originalStringify.apply(this, arguments);
  };

  const originalParse = JSON.parse;
  JSON.parse = function() {
    const value = originalParse.apply(this, arguments);
    if (value && value.result && value.result.movieId && value.result.timedtexttracks) {
      // console.log('parse', value);
      extractMovieTextTracks(value.result);
    }
    return value;
  }

  // Poll periodically to see if current movie has changed
  setInterval(function() {
    const movieIdMatch = URL_MOVIEID_REGEX.exec(window.location.pathname);
    let movieId;
    if (movieIdMatch) {
      movieId = +movieIdMatch[1];
    }
    urlMovieId = movieId;
    if (!urlMovieId) {
      selectedTrackId = null;
    }

    renderAndReconcile();
  }, POLL_INTERVAL_MS);
})();
`;
document.head.insertBefore(el, document.head.firstChild);

// console.log('content script finished');
