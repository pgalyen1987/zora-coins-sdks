plugins {
    `java-library`
    `maven-publish`
    signing
}

group = "io.github.pgalyen1987"
version = "0.1.0"
description = "Typed client for the Zora Coins API (all 30 endpoints), a GraphQL client, and an onchain indexer for Zora creator and referral rewards on Base. Java 11+ and Android."

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
    withJavadocJar()
    withSourcesJar()
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(11) // runs on Java 11+ and Android (with the default desugaring)
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

repositories { mavenCentral() }

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    environment("LIVE", System.getenv("LIVE") ?: "")
    testLogging { events("failed"); showStandardStreams = false; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

tasks.javadoc {
    (options as StandardJavadocDocletOptions).apply {
        addStringOption("Xdoclint:all,-missing", "-quiet")
        windowTitle = "zora-coins " + project.version
    }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            artifactId = "zora-coins"
            pom {
                name.set("zora-coins")
                description.set(project.description)
                url.set("https://github.com/pgalyen1987/zora-coins-sdks")
                licenses { license { name.set("MIT"); url.set("https://opensource.org/licenses/MIT") } }
                developers { developer { id.set("rebelstudios"); name.set("Rebel Studios Software"); email.set("rebelstudiossoftware@gmail.com") } }
                scm { url.set("https://github.com/pgalyen1987/zora-coins-sdks"); connection.set("scm:git:https://github.com/pgalyen1987/zora-coins-sdks.git") }
            }
        }
    }
    repositories {
        // A local Maven layout that scripts/release-java.sh zips and uploads to the Central Portal.
        maven { name = "staging"; url = uri(layout.buildDirectory.dir("staging-deploy")) }
    }
}

// Maven Central needs signed artifacts. Pass the key only when releasing (scripts/release-java.sh does):
//   ORG_GRADLE_PROJECT_signingKey=… ORG_GRADLE_PROJECT_signingPassword=… ./gradlew publish
signing {
    val key = findProperty("signingKey") as String?
    if (key != null) {
        useInMemoryPgpKeys(key, findProperty("signingPassword") as String?)
        sign(publishing.publications["maven"])
    }
}
