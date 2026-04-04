package com.nick.pdfmapper.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.Resource
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import org.springframework.web.servlet.resource.PathResourceResolver
import java.io.IOException

/**
 * Serves the frontend static build (when present) and falls back to index.html for SPA routing.
 * Use app.staticLocations for production (e.g. file:/app/static/) or leave default (classpath:/static/).
 */
@Configuration
class StaticResourceConfig(
  @Value("\${app.staticLocations:classpath:/static/}") private val staticLocations: String,
) : WebMvcConfigurer {

  override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
    registry.addResourceHandler("/**")
      .addResourceLocations(*staticLocations.split(',').map { it.trim() }.toTypedArray())
      .resourceChain(true)
      .addResolver(object : PathResourceResolver() {
        @Throws(IOException::class)
        override fun getResource(resourcePath: String, location: Resource): Resource? {
          // Delegate to default resolution first (includes path checks)
          val candidate = super.getResource(resourcePath, location)
          if (candidate != null) {
            return candidate
          }

          // Fallback to index.html for SPA routes, with the same safety checks
          val index = location.createRelative("index.html")
          return if (index.exists() && index.isReadable) {
            // PathResourceResolver.checkResource(...) is invoked internally by super.getResource,
            // but here we only ever serve index.html from the configured static locations.
            index
          } else {
            null
          }
        }
      })
  }
}
